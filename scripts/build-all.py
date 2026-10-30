#!/usr/bin/env python3
"""Rebuild both readers and generator datasets from any working directory."""

import subprocess
import sys
from pathlib import Path

from model import export_data
from corrections import build_corrections
from app_assets import build_app_assets

SCRIPTS = Path(__file__).resolve().parent


def main():
    for edition in ['mf', 'fm']:
        subprocess.run([sys.executable, str(SCRIPTS / 'build.py'), '--config',
                        str(SCRIPTS / f'config-{edition}.txt')], check=True)
    export_data()
    build_corrections()
    build_app_assets()


if __name__ == '__main__':
    main()
