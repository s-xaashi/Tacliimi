import { supabase } from '/src/services/supabaseClient.js';
import { AuthService } from '/src/services/authService.js';

document.addEventListener('DOMContentLoaded', async () => {
    const totalRevenueEl = document.getElementById('total-revenue');
    const pendingTotalEl = document.getElementById('pending-payouts-total');
    const pendingCountEl = document.getElementById('pending-payouts-count');
    const totalPaidEl = document.getElementById('total-paid');
    const payoutList = document.getElementById('payout-list');
    const refreshBtn = document.getElementById('refresh-data');

    const loadFinanceData = async () => {
        try {
            // 1. Fetch Stats
            // Note: RLS handles the permission check
            const { data: payments, error: pError } = await supabase.from('payments').select('amount');
            const { data: payouts, error: pyError } = await supabase.from('payout_transactions').select('*');

            if (pError || pyError) throw pError || pyError;

            const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
            const totalPaid = payouts.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);
            const pendingPayouts = payouts.filter(p => p.status === 'pending');
            const pendingTotal = pendingPayouts.reduce((sum, p) => sum + (p.amount || 0), 0);

            totalRevenueEl.textContent = `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
            totalPaidEl.textContent = `$${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
            pendingTotalEl.textContent = `$${pendingTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
            pendingCountEl.textContent = `${pendingPayouts.length} Items`;

            // 2. Render Queue
            payoutList.innerHTML = '';
            if (pendingPayouts.length === 0) {
                payoutList.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-slate-400 italic">No pending payouts</td></tr>`;
            } else {
                // We'd usually join with profiles here, but keeping it simple for now as RLS might restrict profile joins if not handled
                pendingPayouts.forEach(p => {
                    const row = document.createElement('tr');
                    row.className = 'hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-default';
                    row.innerHTML = `
                        <td class="px-6 py-4 font-medium">${p.instructor_id.substring(0, 8)}...</td>
                        <td class="px-6 py-4 font-black">$${p.amount.toFixed(2)}</td>
                        <td class="px-6 py-4">
                            <div class="flex flex-col">
                                <span class="text-sm font-medium uppercase">${p.payout_method || 'BANK'}</span>
                            </div>
                        </td>
                        <td class="px-6 py-4 text-slate-400 text-sm">${new Date(p.created_at).toLocaleDateString()}</td>
                        <td class="px-6 py-4 text-right">
                            <button class="approve-btn px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-sm" data-id="${p.id}">
                                Approve
                            </button>
                        </td>
                    `;
                    payoutList.appendChild(row);
                });

                // Add Listeners
                document.querySelectorAll('.approve-btn').forEach(btn => {
                    btn.onclick = async () => {
                        const id = btn.getAttribute('data-id');
                        await approvePayout(id);
                    };
                });
            }
        } catch (err) {
            console.error('Finance load error:', err);
        }
    };

    const approvePayout = async (id) => {
        try {
            const { error } = await supabase
                .from('payout_transactions')
                .update({ 
                    status: 'completed', 
                    processed_at: new Date().toISOString() 
                })
                .eq('id', id);

            if (error) throw error;
            
            // Log the action
            const session = await AuthService.getSession();
            await supabase.from('admin_audit_logs').insert({
                admin_id: session.user.id,
                action: 'approve_payout',
                target_type: 'payout_transaction',
                target_id: id,
                details: { status: 'completed' }
            });

            await loadFinanceData();
        } catch (err) {
            alert('Error approving payout: ' + err.message);
        }
    };

    refreshBtn.onclick = loadFinanceData;
    loadFinanceData();
});
