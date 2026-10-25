"""Rasterize a reproducible GB2312 + UI subset into LVGL's plain 4bpp format."""
from pathlib import Path
from PIL import Image, ImageFont, ImageDraw
import hashlib
import sys

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
font = ImageFont.truetype(str(source), 16)
chars = set(chr(cp) for cp in range(32, 127))
for lead in range(0xA1, 0xF8):
    for trail in range(0xA1, 0xFF):
        try: chars.add(bytes([lead, trail]).decode('gb2312'))
        except UnicodeDecodeError: pass
chars.update('正在录音再按结束发送量设备绑定连接电脑选择会话就绪等待回复失败重试未知提交状态请检查配置切换返回断开网络已保存取消认证错误到达上限暂停操作需要当前内容完成之前恢复不可用中文测试')
codepoints = sorted(map(ord, chars))
ascii_points = list(range(32, 127))
others = [cp for cp in codepoints if cp > 126]
bitmap = bytearray()
descriptors = ['{0,0,0,0,0,0}']
for cp in ascii_points + others:
    ch = chr(cp)
    left, top, right, bottom = font.getbbox(ch, anchor='ls')
    width, height = right-left, bottom-top
    image = Image.new('L', (max(1, width), max(1, height)))
    ImageDraw.Draw(image).text((-left, -top), ch, font=font, fill=255, anchor='ls')
    pixels = [round(value*15/255) for value in list(image.getdata())] if width and height else []
    start = len(bitmap)
    for index in range(0,len(pixels),2): bitmap.append((pixels[index]<<4) | (pixels[index+1] if index+1<len(pixels) else 0))
    # Verify PLAIN nibble packing against rasterization, including odd glyph sizes.
    decoded = [(bitmap[start+i//2] >> (4 if i%2==0 else 0)) & 15 for i in range(len(pixels))]
    assert decoded == pixels
    descriptors.append('{%d,%d,%d,%d,%d,%d}' % (start,round(font.getlength(ch)*16),width,height,left,-bottom))

def rows(values, count=24):
    return ',\n'.join(','.join(str(v) for v in values[i:i+count]) for i in range(0,len(values),count))
text = '/* Generated from Noto Sans SC, SIL OFL 1.1. Source SHA256: '+hashlib.sha256(source.read_bytes()).hexdigest()+' */\n#include "lvgl.h"\n'
text += 'static const uint8_t bitmap[] = {\n'+rows(list(bitmap))+'\n};\n'
text += 'static const lv_font_fmt_txt_glyph_dsc_t glyphs[] = {\n'+',\n'.join(descriptors)+'\n};\n'
text += 'static const uint16_t unicode_list[] = {\n'+rows([cp-others[0] for cp in others])+'\n};\n'
text += '''static const lv_font_fmt_txt_cmap_t cmaps[] = {
{.range_start=32,.range_length=95,.glyph_id_start=1,.type=LV_FONT_FMT_TXT_CMAP_FORMAT0_TINY},
{.range_start=%d,.range_length=%d,.glyph_id_start=96,.unicode_list=unicode_list,.list_length=%d,.type=LV_FONT_FMT_TXT_CMAP_SPARSE_TINY}
};
static const lv_font_fmt_txt_dsc_t descriptor = {
.glyph_bitmap=bitmap,.glyph_dsc=glyphs,.cmaps=cmaps,.cmap_num=2,.bpp=4,.bitmap_format=0
};
const lv_font_t mirtar_font_16 = {
.get_glyph_dsc=lv_font_get_glyph_dsc_fmt_txt,.get_glyph_bitmap=lv_font_get_bitmap_fmt_txt,
.line_height=22,.base_line=5,.dsc=&descriptor,.underline_position=-2,.underline_thickness=1
};
''' % (others[0],others[-1]-others[0]+1,len(others))
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(text,encoding='utf-8')
destination.with_suffix('.codepoints.txt').write_text(' '.join(f'{cp:04X}' for cp in codepoints),encoding='ascii')
print(f'Font: {len(codepoints)} glyphs; {len(bitmap)} bitmap bytes; all packed glyphs verified')
