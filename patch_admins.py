import re

def patch_users():
    with open('src/pages/admin/users/index.html', 'r', encoding='utf-8') as f:
        text = f.read()

    text = re.sub(
        r"const \{ data, error \} = await supabase.rpc\('get_all_users_admin'\);",
        """const { data, error } = await supabase.from('students').select('account_status, user_id, profiles:user_id (id, full_name, avatar_url, email, created_at)');
        if(data) {
            data.forEach(d => {
                d.id = d.user_id;
                d.full_name = d.profiles?.full_name;
                d.avatar_url = d.profiles?.avatar_url;
                d.email = d.profiles?.email;
                d.created_at = d.profiles?.created_at;
                d.role = 'student';
                d.status = d.account_status;
            });
        }""",
        text
    )

    actions_pattern = r'<button class="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-all">\s*<span class="material-symbols-outlined text-\[20px\]">edit_square</span>\s*</button>\s*<button class="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all">\s*<span class="material-symbols-outlined text-\[20px\]">block</span>\s*</button>'

    new_actions = r"""
<button onclick="window.toggleUserBlock('${user.id}', '${user.status === 'blocked' ? 'active' : 'blocked'}')" class="p-2 ${user.status === 'blocked' ? 'text-orange-500 hover:text-orange-600' : 'text-slate-400 hover:text-orange-500'} hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-all" title="${user.status === 'blocked' ? 'Unblock' : 'Block'}">
    <span class="material-symbols-outlined text-[20px]">${user.status === 'blocked' ? 'lock_open' : 'block'}</span>
</button>
<button onclick="window.deleteUser('${user.id}')" class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all" title="Delete">
    <span class="material-symbols-outlined text-[20px]">delete</span>
</button>
"""
    text = re.sub(actions_pattern, new_actions, text)

    methods = """
            window.toggleUserBlock = async (userId, targetStatus) => {
                try {
                    await supabase.from('students').update({ account_status: targetStatus }).eq('user_id', userId);
                    fetchUsers();
                } catch(e) { alert(e.message) }
            };
            window.deleteUser = async (userId) => {
                if(!confirm('Delete this user completely across auth, profiles, and students?')) return;
                try {
                    const session = await AuthService.getSession();
                    const res = await fetch('https://jboruccxbgdqntrggslz.supabase.co/functions/v1/delete-user', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + session.session.access_token, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id_to_delete: userId })
                    });
                    if(!res.ok) throw new Error(await res.text());
                    fetchUsers();
                } catch(e) { alert(e.message) }
            };
            fetchUsers()
"""
    text = text.replace('fetchUsers();', methods)

    text = text.replace(
        '<span class="text-xs font-bold text-slate-600 dark:text-slate-300">Active</span>',
        '<span class="text-xs font-bold text-slate-600 dark:text-slate-300">${(user.status || "active").toUpperCase()}</span>'
    )
    text = text.replace(
        '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>',
        '''<span class="w-1.5 h-1.5 rounded-full ${user.status === 'blocked' ? 'bg-orange-500' : 'bg-emerald-500'}"></span>'''
    )

    with open('src/pages/admin/users/index.html', 'w', encoding='utf-8') as f:
        f.write(text)

def patch_instructors():
    with open('src/pages/admin/instructors/index.html', 'r', encoding='utf-8') as f:
        text = f.read()

    text = re.sub(
        r"const \{ data, error \} = await supabase.rpc\('get_all_instructors_admin'\);",
        """const { data, error } = await supabase.from('instructors').select('*, profiles:user_id (id, full_name, avatar_url, email, created_at, short_bio)');
        if(data) {
            data.forEach(d => {
                d.id = d.user_id;
                d.full_name = d.profiles?.full_name;
                d.short_bio = d.profiles?.short_bio;
                d.avatar_url = d.profiles?.avatar_url;
                d.email = d.profiles?.email;
                d.created_at = d.profiles?.created_at;
                d.course_count = d.total_courses_created;
                d.courses_list = [];
            });
        }""",
        text
    )

    status_pattern = r'<span class="text-\[9px\] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600">\s*Active Instructor\s*</span>'
    new_status = r"""<span class="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${inst.approval_status === 'approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}">
    ${inst.approval_status || 'Pending'}
</span>"""
    text = re.sub(status_pattern, new_status, text)

    actions_pattern = r'<button class="px-4 py-2 bg-slate-50 dark:bg-slate-800 text-\[10px\] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 rounded-xl hover:bg-red-50 hover:text-red-600 transition-all border border-transparent hover:border-100">\s*Manage\s*</button>'
    new_actions = r"""
<div class="flex gap-2 justify-end">
    <button onclick="window.updateStatus('${inst.id}', 'approved')" class="px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black rounded-lg">Approve</button>
    <button onclick="window.updateStatus('${inst.id}', 'blocked')" class="px-3 py-1 bg-red-50 text-red-600 text-[10px] font-black rounded-lg">Block</button>
</div>
"""
    text = re.sub(actions_pattern, new_actions, text)

    methods = """
            window.updateStatus = async (userId, targetStatus) => {
                await supabase.from('instructors').update({ approval_status: targetStatus }).eq('user_id', userId);
                fetchInstructors();
            };
            fetchInstructors()
"""
    text = text.replace('fetchInstructors();', methods)

    with open('src/pages/admin/instructors/index.html', 'w', encoding='utf-8') as f:
        f.write(text)

if __name__ == "__main__":
    patch_users()
    patch_instructors()
    print("Admin tables patched.")
