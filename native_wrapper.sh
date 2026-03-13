#!/bin/bash
# Wrapper to run the Python native host within its virtual environment
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Write a debug log to see if the wrapper even runs
exec > "$DIR/wrapper_debug.log" 2>&1
set -x

echo "Wrapper started at $(date)"
env
echo "Whoami: $(whoami)"

# Path to the virtual environment python
PYTHON_EXE="$DIR/venv/bin/python3"

echo "Using python: $PYTHON_EXE"

# Execute the python script.
exec "$PYTHON_EXE" "$DIR/native_host.py"
