"""Annotate fixed topic questions offline; runtime remains dependency-free.

Install ToJyutping==3.2.0 into .run/jyutping-deps, then run this script.
Source: https://github.com/CanCLID/ToJyutping (BSD-2-Clause).
Generated readings may be corrected in OVERRIDES before rebuilding.
"""
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'.run/jyutping-deps'))
import ToJyutping

OVERRIDES={}

def annotate(match):
    text=match.group(1).replace("\\'", "'")
    unknown=[char for char,reading in ToJyutping.get_jyutping_list(text)
             if not reading and re.search(r'[\u3400-\u9fff]',char)]
    if unknown: raise ValueError(f'Unrecognized characters {unknown}: {text}')
    reading=OVERRIDES.get(text,ToJyutping.get_jyutping_text(text))
    reading=reading.replace('\\','\\\\').replace("'","\\'")
    return match.group(0)+f"\n    jyutping: '{reading}',"

for file in [ROOT/'frontend/src/data/topicDatabase.js',ROOT/'backend/src/data/topicDatabase.js']:
    original=file.read_text(encoding='utf-8')
    original=re.sub(r"\n    jyutping: '(?:\\.|[^'\\])*',",'',original)
    updated,count=re.subn(r"    cantonese: '((?:\\.|[^'\\])*)',",annotate,original)
    if count!=472: raise ValueError(f'Expected 472 questions, got {count}')
    file.write_text(updated,encoding='utf-8')
    print(f'{file.name}: annotated {count} cards')
