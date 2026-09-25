import json
import sys
import re

def process():
    try:
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            outer_data = json.load(f)
        
        result_text = outer_data['result']
        idx_start = result_text.find('[{')
        idx_end = result_text.rfind('}]')
        
        data_str = result_text[idx_start:idx_end+2]
        data = json.loads(data_str)
        
        out_path = 'c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/classification.md'
        with open(out_path, 'w', encoding='utf-8') as out:
            out.write('# SECURITY DEFINER Hardening Classification\n\n')
            
            safe = []
            vulnerable_path = []
            vulnerable_logic = []
            needs_review = []
            
            for func in data:
                name = func.get('function_name', '')
                sig = func.get('argument_signature', '')
                body = func.get('function_body', '')
                
                has_search_path = "set search_path " in body.lower()
                has_auth_uid = "auth.uid()" in body.lower() or "auth.uid()" in body
                
                # Basic heuristics
                if not has_search_path:
                    vulnerable_path.append(name)
                elif not has_auth_uid and any(p in sig.lower() for p in ['id', 'user', 'admin']):
                    # Takes an ID but doesn't check auth.uid()
                    vulnerable_logic.append(name)
                elif has_auth_uid and has_search_path:
                    safe.append(name)
                else:
                    needs_review.append(name)
            
            out.write('## VULNERABLE (SEARCH_PATH)\n')
            for n in vulnerable_path: out.write(f"- {n}\n")
            
            out.write('\n## VULNERABLE (IDOR / PRIV ESCALATION Heuristic)\n')
            for n in vulnerable_logic: out.write(f"- {n}\n")
            
            out.write('\n## SAFE (Heuristic)\n')
            for n in safe: out.write(f"- {n}\n")
            
            out.write('\n## NEEDS REVIEW\n')
            for n in needs_review: out.write(f"- {n}\n")

        print("Classification complete")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    process()
