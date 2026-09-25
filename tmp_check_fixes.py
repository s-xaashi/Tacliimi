import json

with open('C:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/248/output.txt', 'r', encoding='utf-8') as f:
    outer_data = json.load(f)
result_text = outer_data['result']
data = json.loads(result_text[result_text.find('[{'):result_text.rfind('}]')+2])
funcs_to_check = ['create_update_offer', 'get_course_quiz_score', 'get_instructor_courses_refined', 'get_instructor_sales_chart_data', 'confirm_course_rejection_instructor']
for func in data:
    if func.get('function_name') in funcs_to_check:
        body = func.get('function_body', '')
        print(f"=== {func.get('function_name')} ===")
        print(body[:700])
        print()
