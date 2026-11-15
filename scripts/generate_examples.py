"""Generate original exercises and regression data, without external scores.

Run from any directory: python scripts/generate_examples.py
The 80-bar fixture deliberately stresses long-score editing and time mapping.
"""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import new_xml

BASS = ['B0', 'E1', 'A1', 'D2', 'G2']
GUITAR = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']


def pitched(string, fret, midi, *, duration=480, kind='quarter', chord=False,
            tie=None, dead=False, dotted=False):
    n = ET.Element('note')
    if chord:
        ET.SubElement(n, 'chord')
    step, alter = [('C', 0), ('C', 1), ('D', 0), ('D', 1), ('E', 0),
                   ('F', 0), ('F', 1), ('G', 0), ('G', 1), ('A', 0),
                   ('A', 1), ('B', 0)][midi % 12]
    pitch = ET.SubElement(n, 'pitch')
    ET.SubElement(pitch, 'step').text = step
    if alter:
        ET.SubElement(pitch, 'alter').text = str(alter)
    ET.SubElement(pitch, 'octave').text = str(midi // 12 - 1)
    ET.SubElement(n, 'duration').text = str(duration)
    if tie:
        ET.SubElement(n, 'tie', type=tie)
    ET.SubElement(n, 'voice').text = '1'
    ET.SubElement(n, 'type').text = kind
    if dotted:
        ET.SubElement(n, 'dot')
    if dead:
        ET.SubElement(n, 'notehead').text = 'x'
    notations = ET.SubElement(n, 'notations')
    if tie:
        ET.SubElement(notations, 'tied', type=tie)
    technical = ET.SubElement(notations, 'technical')
    ET.SubElement(technical, 'string').text = str(string)
    ET.SubElement(technical, 'fret').text = str(fret)
    return n


def write(root, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(root, space='  ')
    path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' +
                    ET.tostring(root, encoding='unicode') + '\n', encoding='utf-8')


def bass_exercise(bars, title, fixture=False):
    root = ET.fromstring(new_xml(title, BASS, bars, 134 if fixture else 100))
    for i, measure in enumerate(root.findall('./part/measure')):
        if i == 0:
            continue  # Four quarter rests for entry/edit regression tests.
        for n in measure.findall('note'):
            measure.remove(n)
        tied = i % 10 == 2
        for beat in range(4):
            source = 0 if tied and beat == 1 else beat
            string = 1 + (i + source) % 5
            fret = [0, 2, 4, 5, 7][(i * 2 + source) % 5]
            midi = [43, 38, 33, 28, 23][string - 1] + fret
            measure.append(pitched(string, fret, midi,
                tie=('start' if beat == 0 else 'stop') if tied and beat < 2 else None,
                dead=i in (4, 7) and beat == 3))
    return root


def guitar_exercise():
    root = ET.fromstring(new_xml('LocalTab original guitar chord exercise', GUITAR, 4, 90))
    shapes = [[0, 2, 2, 0, 0, 0], [0, 0, 2, 2, 1, 0],
              [3, 2, 0, 0, 0, 3], [0, 2, 2, 0, 0, 0]]
    tuning = [40, 45, 50, 55, 59, 64]
    for measure, frets in zip(root.findall('./part/measure'), shapes):
        for n in measure.findall('note'):
            measure.remove(n)
        for beat in range(2):
            for i, fret in enumerate(frets):
                measure.append(pitched(6 - i, fret, tuning[i] + fret,
                                       duration=960, kind='half', chord=i > 0))
    return root


if __name__ == '__main__':
    write(bass_exercise(80, 'LocalTab synthetic regression fixture', True),
          ROOT / 'tests/fixtures/reference.musicxml')
    write(bass_exercise(8, 'LocalTab original five-string bass exercise'),
          ROOT / 'examples/five-string-bass.musicxml')
    write(guitar_exercise(), ROOT / 'examples/guitar-chords.musicxml')
    print('Generated two original exercises and the synthetic regression fixture.')
