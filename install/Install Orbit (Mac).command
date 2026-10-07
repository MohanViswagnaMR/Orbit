#!/bin/bash
# Double-click in Finder to install (or update) Orbit on a Mac.
cd "$(dirname "$0")" && bash ./install.sh
echo
read -n 1 -s -r -p "Press any key to close this window."
