// Isolated loopback media engine, served under an unguessable per-input URL.
(async () => {
  let pc, ac, source, timer, failed = false, drained = false, closing = false;
  const parts = new Map(); let ordinal = 0, characters = 0;
  const post = (path, value) => fetch(path, { method: 'POST', body: value === undefined ? '' : JSON.stringify(value) });
  const cleanup = () => { clearTimeout(timer); if (pc) pc.close(); if (ac) void ac.close(); };
  const fail = async (code = 'native_voice_incomplete') => {
    if (failed) return; failed = true;
    try { await post('failed', code); } finally { cleanup(); }
  };
  try {
    ac = new AudioContext({ sampleRate: 16000 }); await ac.resume();
    if (ac.sampleRate !== 16000) throw Error('sample_rate');
    await ac.audioWorklet.addModule('worklet');
    source = new AudioWorkletNode(ac, 'mirtar-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    const dest = ac.createMediaStreamDestination(); source.connect(dest);
    pc = new RTCPeerConnection(); for (const track of dest.stream.getTracks()) pc.addTrack(track, dest.stream);
    const dc = pc.createDataChannel('oai-events');
    dc.onmessage = async ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === 'input_transcript.added') {
          const item = event.item;
          if (typeof item?.id !== 'string' || typeof item.text !== 'string' ||
              !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)) throw Error('invalid_transcript');
          // Native segment IDs restart across speech turns. Audio time is part
          // of the identity so a later phrase cannot replace an earlier one.
          const key = event.start_ms + ':' + item.id;
          const previous = parts.get(key);
          characters += item.text.length - (previous?.text.length ?? 0);
          if (characters > 64000 || parts.size >= 20000) throw Error('transcript_limit');
          parts.set(key, { text: item.text, start: event.start_ms, order: previous?.order ?? ordinal++ });
        } else if (event.type === 'session.closed') {
          // Segments and final marker share one ordered native data channel.
          if (!closing || !drained || failed || event.reason !== 'client_request') throw Error('early_close');
          const text = [...parts.values()].sort((a, b) => a.start - b.start || a.order - b.order).map(p => p.text).join('').trim();
          const response = await post('final', { text, reason: event.reason, segments: parts.size });
          if (!response.ok) throw Error('incomplete_transcript');
          cleanup();
        } else if (event.type === 'error' || event.type === 'session.error') throw Error('voice_error');
      } catch (error) { await fail(error.message); }
    };
    dc.onclose = () => { if (!closing) void fail(); };
    source.port.onmessage = async ({ data }) => {
      try {
        if (data.error) throw Error('audio_backpressure');
        if (!data.drained) return;
        const response = await post('drained', { samples: data.samples });
        if (!response.ok || dc.readyState !== 'open') throw Error('incomplete_audio');
        drained = true; closing = true;
        // All samples plus two seconds of silence have traversed the RTP track.
        // Keep media/events open while the native session drains its tail.
        timer = setTimeout(() => void fail('native_transcript_timeout'), 90000);
        dc.send(JSON.stringify({ type: 'session.close' }));
      } catch (error) { await fail(error.message); }
    };
    await pc.setLocalDescription(await pc.createOffer());
    const response = await fetch('offer', { method: 'POST', body: pc.localDescription.sdp });
    if (!response.ok) throw Error('signal');
    await pc.setRemoteDescription({ type: 'answer', sdp: (await response.json()).sdp });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('connect')), 20000);
      const check = () => {
        if (pc.connectionState === 'connected' && dc.readyState === 'open') { clearTimeout(timeout); resolve(); }
        else if (pc.connectionState === 'failed') { clearTimeout(timeout); reject(Error('connect')); }
      };
      pc.onconnectionstatechange = check; dc.onopen = check; check();
    });
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') void fail(); };
    const input = await fetch('stream'); if (!input.ok || !input.body) throw Error('stream');
    const reader = input.body.getReader(); let carry = new Uint8Array(0);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (failed) { await reader.cancel(); return; }
      const bytes = new Uint8Array(carry.length + value.length); bytes.set(carry); bytes.set(value, carry.length);
      const even = bytes.length - bytes.length % 2;
      carry = bytes.slice(even);
      if (even) { const pcm = bytes.slice(0, even).buffer; source.port.postMessage(pcm, [pcm]); }
    }
    if (carry.length) throw Error('incomplete_sample');
    source.port.postMessage({ end: true });
  } catch (error) { await fail(error.message); }
})();
