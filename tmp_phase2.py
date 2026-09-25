import json
import sys
import re
import os

def analyze():
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        outer_data = json.load(f)
    result_text = outer_data['result']
    idx_start = result_text.find('[{')
    idx_end = result_text.rfind('}]')
    data_str = result_text[idx_start:idx_end+2]
    data = json.loads(data_str)

    # We also want to cross check the repository
    repo_funcs = set()
    for root, dirs, files in os.walk('c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/db/migrations'):
        for file in files:
            if file.endswith('.sql'):
                with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                    content = f.read()
                    matches = re.findall(r'CREATE (?:OR REPLACE )?FUNCTION public\.([a-zA-Z0-9_]+)', content, re.IGNORECASE)
                    for m in matches:
                        repo_funcs.add(m.lower())

    previous_fixes = {
        'get_course_details_admin', 'purchase_boost', 'purchase_promo_banner',
        'purchase_boost_and_banner_atomic', 'confirm_course_rejection_instructor',
        'get_instructor_courses_refined', 'get_instructor_sales_chart_data',
        'create_update_offer', 'get_course_quiz_score'
    }

    critical = []
    high = []
    medium = []
    low = []
    secure = []
    
    prod_missing_from_git = []
    git_missing_from_prod = []

    for func in data:
        name = func.get('function_name', '')
        sig = func.get('argument_signature', '') or ''
        body = func.get('function_body', '') or ''
        priv = func.get('privileges', '') or ''
        is_secdef = func.get('is_secdef', False)
        
        sig_lower = sig.lower()
        body_lower = body.lower()
        
        # Check privileges
        anon_can_exec = 'anon=X' in priv or priv.startswith('=X') or ',=X' in priv
        auth_can_exec = 'authenticated=X' in priv or priv.startswith('=X') or ',=X' in priv
        can_exec = anon_can_exec or auth_can_exec

        if name.lower() not in repo_funcs:
            prod_missing_from_git.append(name)
        elif name.lower() in repo_funcs:
            # We remove it so we can find things in Git but NOT in production later
            # (But `repo_funcs` is just names, multiple overloads exist)
            pass

        # Heuristics
        has_auth_uid = "auth.uid()" in body_lower
        is_financial = any(word in name.lower() for word in ['purchase', 'payment', 'withdraw', 'payout', 'refund', 'commission', 'boost', 'wallet', 'balance', 'fee'])
        accepts_id = any(p in sig_lower for p in ['user_id', 'instructor_id', 'student_id', 'admin_id', '_id uuid', 'course_id', 'enrollment_id', 'session_id'])
        
        is_trigger = "returns trigger" in body_lower or "returns event_trigger" in body_lower
        
        if is_trigger:
            secure.append(name + " (Trigger)")
            continue

        if not can_exec:
            if is_secdef:
                secure.append(f"{name} (SECDEF but Revoked)")
            else:
                secure.append(f"{name} (Invoker but Revoked)")
            continue
            
        if name in previous_fixes:
            secure.append(f"{name} (Previously Fixed)")
            continue

        if is_secdef:
            if accepts_id and not has_auth_uid:
                critical.append(name)
            elif is_financial and not has_auth_uid:
                critical.append(name)
            elif 'admin' in name.lower() and not has_auth_uid:
                high.append(name)
            elif accepts_id and has_auth_uid:
                secure.append(f"{name} (SECDEF, has auth.uid)")
            else:
                medium.append(f"{name} (SECDEF, no explicit ID arg/no auth check)")
        else:
            # SEC INVOKER
            if accepts_id and not has_auth_uid:
                # Relying on RLS
                medium.append(f"{name} (INVOKER, relying on RLS)")
            else:
                low.append(f"{name} (INVOKER)")

    # Find Git functions missing from PROD
    produced_names = {f.get('function_name', '').lower() for f in data}
    for repo_name in repo_funcs:
        if repo_name not in produced_names:
            git_missing_from_prod.append(repo_name)

    out_path = 'c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/phase2_draft.json'
    with open(out_path, 'w', encoding='utf-8') as out:
        json.dump({
            "critical": critical,
            "high": high,
            "medium": medium,
            "low": low,
            "secure": secure,
            "prod_missing_from_git": prod_missing_from_git,
            "git_missing_from_prod": git_missing_from_prod
        }, out, indent=2)

if __name__ == '__main__':
    analyze()
