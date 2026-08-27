import re

path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

orig_len = len(c)

# 1. Add skeleton-node-select to mm-provider
c = re.sub(r'(id="mm-provider"[\s\S]{1,150}?class="[^"]+?)(")', r'\1 skeleton-node-select\2', c, count=1)

# 2. Add skeleton-node to mm-phone
c = re.sub(r'(id="mm-phone" type="tel"[\s\S]{1,150}?class="[^"]+?)(")', r'\1 skeleton-node\2', c, count=1)

# 3. Add skeleton-node to cod-address and add error span
c = re.sub(r'(id="cod-address" type="text"[\s\S]{1,150}?class="[^"]+?)("[\s\S]{1,150}?placeholder="[^"]+" />)', r'\1 skeleton-node\2\n                                                 <span id="cod-address-error" class="hidden text-xs text-red-500 mt-1"></span>', c, count=1)

# 4. Add skeleton-node to cod-city and add error span
c = re.sub(r'(id="cod-city" type="text"[\s\S]{1,150}?class="[^"]+?)("[\s\S]{1,150}?placeholder="[^"]+" />)', r'\1 skeleton-node\2\n                                                     <span id="cod-city-error" class="hidden text-xs text-red-500 mt-1"></span>', c, count=1)

# 5. Add skeleton-node to cod-country and add error span
c = re.sub(r'(id="cod-country" type="text"[\s\S]{1,150}?class="[^"]+?)("[\s\S]{1,150}?placeholder="[^"]+" />)', r'\1 skeleton-node\2\n                                                     <span id="cod-country-error" class="hidden text-xs text-red-500 mt-1"></span>', c, count=1)

# 6. Add skeleton-node to cod-phone
c = re.sub(r'(id="cod-phone" type="tel"[\s\S]{1,150}?class="[^"]+?)("[\s\S]{1,150}?placeholder="[^"]+" />)', r'\1 skeleton-node\2', c, count=1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print(f'Done. Len before={orig_len}, after={len(c)}')
