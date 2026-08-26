import json
import sys

def process():
    try:
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            outer_data = json.load(f)
        
        result_text = outer_data['result']
        
        idx_start = result_text.find('[{')
        idx_end = result_text.rfind('}]')
        if idx_start == -1 or idx_end == -1:
            print("No JSON array found in result text")
            return
            
        data_str = result_text[idx_start:idx_end+2]
        data = json.loads(data_str)
        
        out_path = 'c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/function_bodies.md'
        with open(out_path, 'w', encoding='utf-8') as out:
            out.write('# Function Bodies for Analysis\n\n')
            for func in data:
                out.write(f"## {func.get('function_name', 'N/A')}\n")
                out.write(f"**Signature**: `{func.get('argument_signature', 'N/A')}`\n")
                out.write(f"**Privileges**: `{func.get('privileges', 'N/A')}`\n")
                out.write("```sql\n")
                out.write(f"{func.get('function_body', 'NO BODY')}\n")
                out.write("```\n\n")
        print(f"Successfully wrote {len(data)} functions to {out_path}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    process()
