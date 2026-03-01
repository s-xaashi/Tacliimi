import os
import json
import urllib.request
import subprocess

project_id = "10714692619951147458"
screens = [
    "1c165996eb9244c5b76f7726b2ffca79",
    "3c7c0a2e083847dc875edb9436903953",
    "7572790f367a40beb86b11ba055ec0b6",
    "7abc57fe4cc44d65a71aa7d93b5b6373",
    "d8289765384f4237898d7447f09f0293",
    "dbf62584367f4448a343bd715d38500f",
    "e0a0ece4b05244e4a19ecdfb36886a32",
    "ee28bf8af08745e0884e1875398b60f7"
]

out_dir = "instructor-courses/wizard-screens"
os.makedirs(out_dir, exist_ok=True)

# Note: Ideally we'd hit the API directly but we only have an MCP tool available in the main process.
# We will use string output from a previous curl or simply have the agent call get_screen repeatedly. 
# It's better to fetch via the agent tools! 
print("Script saved, use the agent's MCP tool directly to fetch each screen's download URL and download them here.")
