"""Retry only successful-but-empty compiler queries on affected Windows hosts.

This patches the project-private ESP-IDF 5.5.6 build helper, not the compiler or
firmware. Every result still comes from the real compiler; final failure is fatal.
No endpoint-security settings are changed.
"""
from pathlib import Path
import sys

path = Path(sys.argv[1])/'tools/cmake/compiler_query.cmake'
source = path.read_text(encoding='utf-8').replace('if(WIN32)', 'if(CMAKE_HOST_WIN32)')
path.write_text(source, encoding='utf-8')
query_helper = Path(__file__).with_name('verified_compiler_query.py')
(path.parent/'mirtar_compiler_query.py').write_text(query_helper.read_text(encoding='utf-8'), encoding='utf-8')
capture_marker = '# MirTar: file-backed capture of real compiler query output.'
capture_anchor = '''    execute_process(
        COMMAND ${ARGN}
        OUTPUT_VARIABLE query_output
        RESULT_VARIABLE query_result
        OUTPUT_STRIP_TRAILING_WHITESPACE)'''
if capture_marker not in source:
    assert source.count(capture_anchor) == 1, 'Unexpected compiler query helper; no capture patch applied'
    captured = '''    # MirTar: file-backed capture of real compiler query output.
    if(CMAKE_HOST_WIN32)
        execute_process(COMMAND "${PYTHON}" "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/mirtar_compiler_query.py" ${ARGN}
            OUTPUT_VARIABLE query_output RESULT_VARIABLE query_result OUTPUT_STRIP_TRAILING_WHITESPACE)
    else()
'''+capture_anchor+'''
    endif()'''
    source = source.replace(capture_anchor, captured)
    path.write_text(source, encoding='utf-8')
    print('Enabled real compiler file capture; original fatal query guard retained')
marker = '# MirTar: bounded retry for zero-exit empty Windows tool output.'
if marker in source:
    print('Compiler query retry already present')
anchor = '    if(NOT query_result EQUAL 0 OR query_output STREQUAL "")'
assert source.count(anchor) == 1, 'Unexpected SDK helper; no patch applied'
retry = '''    # MirTar: bounded retry for zero-exit empty Windows tool output.
    if(CMAKE_HOST_WIN32)
        foreach(query_attempt RANGE 1 12)
            if(NOT query_result EQUAL 0 OR NOT query_output STREQUAL "")
                break()
            endif()
            execute_process(COMMAND "${CMAKE_COMMAND}" -E sleep 0.1)
            execute_process(COMMAND ${ARGN}
                OUTPUT_VARIABLE query_output RESULT_VARIABLE query_result
                OUTPUT_STRIP_TRAILING_WHITESPACE)
        endforeach()
    endif()

'''
if marker not in source:
    path.write_text(source.replace(anchor,retry+anchor),encoding='utf-8')
    print('Applied bounded compiler-query retry to private SDK; original fatal guard retained')

ldgen = Path(sys.argv[1])/'tools/ldgen/ldgen.py'
source = ldgen.read_text(encoding='utf-8')
marker = '# MirTar: retry empty successful objdump output, keep parser/failure guards.'
anchor = "    output = subprocess.check_output([objdump, '-h', library], env=new_env).decode()"
if marker not in source:
    assert source.count(anchor) == 1, 'Unexpected SDK linker helper; no patch applied'
    retry = '''
    # MirTar: retry empty successful objdump output, keep parser/failure guards.
    for _mirtar_attempt in range(12):
        if os.name != 'nt' or output.strip():
            break
        __import__('time').sleep(0.1)
        output = subprocess.check_output([objdump, '-h', library], env=new_env).decode()
'''
    ldgen.write_text(source.replace(anchor,anchor+retry),encoding='utf-8')
    print('Applied bounded linker metadata retry to private SDK; parser and fatal guards retained')

# Non-empty output can also be truncated. Verify real output against all members
# and section sizes in the already compiled ELF archive before returning it.
helper_source = Path(__file__).with_name('verified_objdump.py')
helper_target = ldgen.parent/'mirtar_verified_objdump.py'
helper_target.write_text(helper_source.read_text(encoding='utf-8'),encoding='utf-8')
source = ldgen.read_text(encoding='utf-8')
marker = '# MirTar: verify real metadata against the physical ELF archive.'
anchor = "    output = subprocess.check_output([objdump, '-h', library], env=new_env).decode()"
if marker not in source:
    replacement = '''    # MirTar: verify real metadata against the physical ELF archive.
    if os.name == 'nt':
        from mirtar_verified_objdump import run_verified
        return run_verified(objdump, library, new_env)

'''
    assert anchor in source
    source = source.replace(anchor,replacement+anchor,1)
    ldgen.write_text(source,encoding='utf-8')
    print('Enabled complete ELF metadata verification; no synthetic data or relaxed parser')
