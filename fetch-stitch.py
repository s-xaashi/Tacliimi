import urllib.request
url = "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzljMzJlZGRiYzUwMjQxMThhNWM1ZDEyZmQxZTc4MDMzEgsSBxD1nv77kBcYAZIBJAoKcHJvamVjdF9pZBIWQhQxMDcxNDY5MjYxOTk1MTE0NzQ1OA&filename=&opi=89354086"
with urllib.request.urlopen(url) as response, open('student-dashboard-stitch.html', 'wb') as out_file:
    data = response.read()
    out_file.write(data)
