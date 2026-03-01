import os
import urllib.request

urls = {
    "1c165996eb9244c5b76f7726b2ffca79": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzBjMjA3YTJhNWE5MTRkZWY5NTJjYThjNTZjMTNlMzA4EgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086",
    "3c7c0a2e083847dc875edb9436903953": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzhjMGQ4MGM4OTM4NTRiZDViMTIzNjEyZGM1OTQ1MDRiEgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086",
    "7572790f367a40beb86b11ba055ec0b6": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzI3ODljMDg5Y2MyZDQ4ZmQ4MGFjZTdkNTY4YmZiYmY1EgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086",
    "7abc57fe4cc44d65a71aa7d93b5b6373": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzYxZmVjZGY1ZTRiMzRjZGFhZjM0MzgyMzg2ZjQ5OTkxEgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086",
    "d8289765384f4237898d7447f09f0293": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzViNDNkM2RkNDU0YzQ2NmRiNjkzZjRmZWFmZDZlOTg5EgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086",
    "dbf62584367f4448a343bd715d38500f": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzVmZjc3Mzc3NmRhYTRlNzQ5NTViMDY5MTg5Y2Y3NDA4EgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086",
    "e0a0ece4b05244e4a19ecdfb36886a32": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzZhMmY4ZjllZjVkYjQ1NTc5MjcxM2U2ODc4ZWJiODRmEgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086",
    "ee28bf8af08745e0884e1875398b60f7": "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzk1ZDc0ZDVhNDNmYjRhMDBiYzNmZDhmYzVhYTA3OThkEgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086",
}

out_dir = "instructor-courses/wizard-screens"
os.makedirs(out_dir, exist_ok=True)

for screen, url in urls.items():
    out_path = os.path.join(out_dir, f"{screen}.html")
    print(f"Downloading {screen} to {out_path}...")
    try:
        urllib.request.urlretrieve(url, out_path)
        print("Success!")
    except Exception as e:
        print(f"Failed: {e}")
