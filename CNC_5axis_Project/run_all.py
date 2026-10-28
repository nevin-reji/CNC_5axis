"""Regenerate every result, figure, the G-code and the simulator data (about 40 s).
Works from any folder and on Windows, macOS and Linux."""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = ["kinematics.py", "motion_planner.py", "axis_control.py", "tool_monitor.py", "probing.py",
           "draw_architecture.py", "draw_diagrams.py"]

os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
for s in SCRIPTS:
    print(f"== {s}", flush=True)
    subprocess.run([sys.executable, s], check=True, cwd=HERE)
