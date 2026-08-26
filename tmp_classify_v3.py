import json
import sys

def process():
    try:
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            outer_data = json.load(f)
        
        result_text = outer_data['result']
        idx_start = result_text.find('[{')
        idx_end = result_text.rfind('}]')
        
        data_str = result_text[idx_start:idx_end+2]
        data = json.loads(data_str)
        
        out_path = 'c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/classification_v3.md'
        with open(out_path, 'w', encoding='utf-8') as out:
            out.write('# SECURITY DEFINER Hardening Classification V3\n\n')
            
            safe_by_priv = []
            vulnerable_path = []
            vulnerable_logic = []
            needs_review = []
            safe_logic = []
            
            for func in data:
                name = func.get('function_name', '')
                sig = func.get('argument_signature', '')
                body = func.get('function_body', '')
                priv = func.get('privileges', '')
                
                # Check for search_path
                has_search_path = "set search_path " in body.lower()
                
                # Check for caller ID usage in args
                has_auth_uid = "auth.uid()" in body.lower()
                takes_user_id = any(p in sig.lower() for p in ['id', 'user', 'admin', 'student', 'instructor'])
                
                # Public means public pseudo-role "=X" (which means PUBLIC=X)
                # Authenticated means "authenticated=X"
                # Anon means "anon=X"
                can_exec = 'authenticated=X' in priv or 'anon=X' in priv or priv.startswith("=X") or ",=X" in priv
                
                if not has_search_path:
                    vulnerable_path.append(name)
                elif not can_exec:
                    safe_by_priv.append(name)
                elif (not has_auth_uid) and takes_user_id:
                    vulnerable_logic.append(name)
                elif has_auth_uid:
                    safe_logic.append(name)
                else:
                    needs_review.append(name)
            
            out.write('## VULNERABLE (SEARCH_PATH)\n')
            for n in vulnerable_path: out.write(f"- {n}\n")
            
            out.write('\n## VULNERABLE LOGIC (Exposed + IDs as args but no auth.uid())\n')
            for n in vulnerable_logic: out.write(f"- {n}\n")
            
            out.write('\n## NEEDS REVIEW (Exposed + complex args/no direct ID/no auth.uid())\n')
            for n in needs_review: out.write(f"- {n}\n")

            out.write('\n## SAFE BY REVOKE (Not exposed to authenticated/anon)\n')
            for n in safe_by_priv: out.write(f"- {n}\n")
            
            out.write('\n## SAFE BY LOGIC (Exposed + checks auth.uid())\n')
            for n in safe_logic: out.write(f"- {n}\n")
            
        print("Classification complete")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    process()
