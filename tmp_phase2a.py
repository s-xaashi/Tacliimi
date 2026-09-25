"""
Phase 2A: Production → Repository Baseline Synchronization Script
Reads production function data, compares with git, generates baseline SQL.
"""
import json
import sys
import os
import re
from datetime import datetime

MIGRATIONS_DIR = r'c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/db/migrations'
OUT_SQL = r'c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/db/migrations/20260826_production_function_security_baseline.sql'
REPORT_OUT = r'c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/phase2a_report.md'

SECTION_MAP = {
    'financial': ['payment', 'withdraw', 'payout', 'refund', 'commission', 'wallet', 'balance', 'fee', 'earnings', 'coupon'],
    'promotion': ['boost', 'promo', 'banner', 'promotion'],
    'admin': ['admin_', 'is_admin', 'check_is_'],
    'instructor': ['instructor', 'teaching', 'mentor_reschedule', 'appeal_course', 'confirm_course', 'reject_course', 'approve_course', 'get_pending_courses', 'get_or_create_course', 'sync_course', 'get_course_performance', 'get_course_quiz', 'get_instructor', 'create_update_offer', 'handle_course', 'get_course_details_admin', 'appeal'],
    'student': ['student', 'enrollment', 'check_course', 'check_lesson', 'check_section', 'generate_cert'],
    'analytics': ['analytics', 'stats', 'chart', 'demographics', 'performance', 'track_search'],
    'notification': ['notification', 'broadcast'],
    'utility': []  # catch-all
}

def categorize(name):
    name_lower = name.lower()
    for cat, keywords in SECTION_MAP.items():
        if cat == 'utility':
            continue
        for kw in keywords:
            if kw in name_lower:
                return cat
    return 'utility'

def parse_priv(priv):
    return {
        'public': '=X' in priv or priv.startswith('=X'),
        'anon': 'anon=X' in priv,
        'authenticated': 'authenticated=X' in priv,
        'service_role': 'service_role=X' in priv,
        'raw': priv
    }

def extract_git_definitions():
    """Extract function names from all .sql files in migrations dir"""
    git_funcs = {}  # name -> {file, body_snippet}
    for fname in os.listdir(MIGRATIONS_DIR):
        if not fname.endswith('.sql'):
            continue
        fpath = os.path.join(MIGRATIONS_DIR, fname)
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        matches = re.findall(
            r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-zA-Z0-9_]+)',
            content, re.IGNORECASE
        )
        for m in matches:
            key = m.lower()
            if key not in git_funcs:
                git_funcs[key] = {'file': fname, 'count': 0}
            git_funcs[key]['count'] = git_funcs[key].get('count', 0) + 1
    return git_funcs

def generate():
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        outer = json.load(f)
    result_text = outer['result']
    idx_start = result_text.find('[{')
    idx_end = result_text.rfind('}]')
    data = json.loads(result_text[idx_start:idx_end+2])

    git_funcs = extract_git_definitions()
    prod_names = set()

    # Phase buckets
    sections = {k: [] for k in SECTION_MAP.keys()}
    
    git_only = sorted(set(git_funcs.keys()) - {f.get('function_name','').lower() for f in data})
    prod_missing_from_git = []
    both_present = []  # (prod_name, git_file)
    
    for func in data:
        name = func.get('function_name', '')
        key = name.lower()
        sig = func.get('argument_signature', '') or ''
        body = func.get('function_body', '') or ''
        priv = func.get('privileges', '') or ''
        is_secdef = func.get('is_secdef', False)
        lang = func.get('language', '')
        vol = func.get('volatility', '')
        cfg = func.get('config_params', []) or []
        owner = func.get('owner', '')
        
        priv_data = parse_priv(priv)
        search_path = 'public' if any('search_path' in c for c in cfg) else 'NOT SET'
        
        prod_names.add(key)
        cat = categorize(name)
        sections[cat].append({
            'name': name,
            'sig': sig,
            'body': body,
            'priv': priv_data,
            'is_secdef': is_secdef,
            'lang': lang,
            'search_path': search_path,
            'owner': owner,
        })
        
        if key not in git_funcs:
            prod_missing_from_git.append(name)
        else:
            both_present.append((name, git_funcs[key]['file']))

    # Write SQL baseline
    with open(OUT_SQL, 'w', encoding='utf-8') as f:
        f.write("""-- ============================================================
-- PRODUCTION FUNCTION SECURITY BASELINE
-- Generated from live Tacliimi Supabase database
-- Project: jboruccxbgdqntrggslz
-- Date: 2026-08-26
-- Purpose: Version-control snapshot of production functions absent from Git.
--          DO NOT EXECUTE against production. 
--          This is a READ-ONLY synchronization record.
-- ============================================================

""")
        section_titles = {
            'financial': 'FINANCIAL FUNCTIONS',
            'promotion': 'PROMOTION FUNCTIONS (Boost / Banner)',
            'admin': 'ADMIN FUNCTIONS',
            'instructor': 'INSTRUCTOR / COURSE FUNCTIONS',
            'student': 'STUDENT FUNCTIONS',
            'analytics': 'ANALYTICS FUNCTIONS',
            'notification': 'NOTIFICATION FUNCTIONS',
            'utility': 'UTILITY / SYSTEM FUNCTIONS',
        }
        for cat, title in section_titles.items():
            funcs = sections[cat]
            if not funcs:
                continue
            f.write(f"-- ============================================================\n")
            f.write(f"-- {title}\n")
            f.write(f"-- ============================================================\n\n")
            for fn in funcs:
                # Write security metadata header
                f.write(f"-- Function: {fn['name']}\n")
                f.write(f"-- SECURITY DEFINER: {fn['is_secdef']}\n")
                f.write(f"-- search_path: {fn['search_path']}\n")
                f.write(f"-- Owner: {fn['owner']}\n")
                f.write(f"-- EXECUTE: public={fn['priv']['public']}, anon={fn['priv']['anon']}, ")
                f.write(f"authenticated={fn['priv']['authenticated']}, service_role={fn['priv']['service_role']}\n")
                f.write(f"-- Raw ACL: {fn['priv']['raw']}\n")
                f.write(f"{fn['body']}\n\n")
                # Restore grants
                f.write(f"-- Grants for {fn['name']}:\n")
                if fn['priv']['anon']:
                    f.write(f"GRANT EXECUTE ON FUNCTION public.{fn['name']}({fn['sig']}) TO anon;\n")
                if fn['priv']['authenticated']:
                    f.write(f"GRANT EXECUTE ON FUNCTION public.{fn['name']}({fn['sig']}) TO authenticated;\n")
                if fn['priv']['service_role']:
                    f.write(f"GRANT EXECUTE ON FUNCTION public.{fn['name']}({fn['sig']}) TO service_role;\n")
                f.write(f"\n")

    # Write report
    with open(REPORT_OUT, 'w', encoding='utf-8') as f:
        f.write("## Production Function Baseline Report\n\n")
        f.write(f"### Total production public functions\n{len(data)}\n\n")
        f.write(f"### Functions already represented in Git\n{len(both_present)}\n\n")
        f.write(f"### Production-only functions (missing from Git)\n{len(prod_missing_from_git)}\n\n")
        f.write(f"### Git-only functions (missing from production)\n{len(git_only)}\n\n")
        
        f.write("#### Production functions already in Git:\n")
        for name, gitfile in sorted(set(both_present)):
            f.write(f"- `{name}` ← `{gitfile}`\n")
        f.write("\n")
        
        f.write("#### Production-only functions captured in baseline:\n")
        for name in sorted(set(prod_missing_from_git)):
            f.write(f"- `{name}`\n")
        f.write("\n")
        
        f.write("#### Git-only functions (not in production):\n")
        for name in git_only:
            f.write(f"- `{name}`\n")
        f.write("\n")
        
    print(f"Done. {len(data)} functions processed.")
    print(f"  Git-only: {len(git_only)}")
    print(f"  Prod-missing-from-git: {len(prod_missing_from_git)}")
    print(f"  Both present: {len(both_present)}")

if __name__ == '__main__':
    generate()
