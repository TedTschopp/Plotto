#!/usr/bin/env python3
"""Rebuild both readers and generator datasets from any working directory."""

import subprocess
import sys
from pathlib import Path

from model import export_data

SCRIPTS = Path(__file__).resolve().parent


def main():
    for edition in ['mf', 'fm']:
        subprocess.run([sys.executable, str(SCRIPTS / 'build.py'), '--config',
                        str(SCRIPTS / f'config-{edition}.txt')], check=True)
    export_data()


if __name__ == '__main__':
    main()
