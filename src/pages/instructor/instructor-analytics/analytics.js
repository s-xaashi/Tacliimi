import { AuthService } from '../../../services/authService.js';
import { supabase } from '../../../services/supabaseClient.js';

let performanceChartInstance = null;
let revenueChartInstance = null;
let currentInstructorId = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const session = await AuthService.getSession();
        if (!session) return;
        
        currentInstructorId = session.user.id;

        // Populate Overview top metrics
        const { data: overview, error: overviewError } = await supabase
            .rpc('get_instructor_analytics_overview', { p_instructor_id: currentInstructorId });

        if (!overviewError && overview) {
            document.getElementById('metric-revenue').innerText = `$${overview.totalRevenue.toLocaleString()}`;
            document.getElementById('metric-students').innerText = overview.totalStudentsEnrolled.toLocaleString();
            document.getElementById('metric-views').innerText = overview.totalCourseViews.toLocaleString();
            document.getElementById('metric-rating').innerText = overview.averageCourseRating.toFixed(1);
            document.getElementById('metric-completions').innerText = `${overview.courseCompletionRate.toFixed(1)}%`;
        }

        // Fetch Top Courses table
        const { data: topCourses, error: topCoursesError } = await supabase
            .rpc('get_course_performance_table', { p_instructor_id: currentInstructorId });
        
        if (!topCoursesError && topCourses && topCourses.length > 0) {
            const tableBody = document.getElementById('top-courses-table-body');
            tableBody.innerHTML = '';
            
            topCourses.forEach(course => {
                const tr = document.createElement('tr');
                tr.classList.add('hover:bg-slate-50', 'dark:hover:bg-slate-800/50', 'transition-colors');
                tr.innerHTML = `
                    <td class="p-4">
                        <div class="flex items-center gap-3">
                            <img src="${course.thumbnailUrl || '/images/course-placeholder.jpg'}" alt="${course.title}" class="w-12 h-12 rounded object-cover cursor-pointer" onclick="window.location.href='/src/pages/instructor/instructor-course-wizard/index.html?id=${course.id}'">
                            <div>
                                <p class="font-medium text-slate-900 dark:text-white cursor-pointer hover:text-primary" onclick="window.location.href='/src/pages/instructor/instructor-course-wizard/index.html?id=${course.id}'">${course.title}</p>
                                <p class="text-xs text-slate-500">CRS-${course.crsId || 'UNKNOWN'}</p>
                            </div>
                        </div>
                    </td>
                    <td class="p-4 text-slate-700 dark:text-slate-300">${course.totalStudents}</td>
                    <td class="p-4 font-medium text-slate-900 dark:text-white">$${course.revenueGenerated.toFixed(2)}</td>
                    <td class="p-4">
                        <div class="flex items-center gap-1">
                            <span class="material-symbols-outlined text-amber-400 text-sm">star</span>
                            <span class="text-slate-700 dark:text-slate-300 text-sm font-medium">${Number(course.rating).toFixed(1)}</span>
                            <span class="text-xs text-slate-400">(${course.numberOfReviews})</span>
                        </div>
                    </td>
                    <td class="p-4 text-slate-700 dark:text-slate-300">${course.views}</td>
                `;
                tableBody.appendChild(tr);
            });
        } else {
            const tableBody = document.getElementById('top-courses-table-body');
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">No course data available yet. Your performance metrics will appear here once you publish courses and students interact with them.</td></tr>';
            }
        }

        // Setup filter listener
        const periodFilter = document.getElementById('chartPeriodFilter');
        if (periodFilter) {
            periodFilter.addEventListener('change', (e) => {
                loadChartData(e.target.value);
            });
        }

        // Fetch initial chart data
        await loadChartData('30days');

    } catch (err) {
        console.error('Failed to initialize analytics:', err);
    }
});

async function loadChartData(period) {
    if (!currentInstructorId) return;

    try {
        const { data: chartResponse, error: chartError } = await supabase
            .rpc('get_instructor_sales_chart_data', { p_instructor_id: currentInstructorId, p_period: period });

        if (!chartError && chartResponse && chartResponse.chartData) {
            initCharts(chartResponse.chartData);
        }
    } catch (err) {
        console.error('Failed to update chart data:', err);
    }
}

function initCharts(data) {
    const dates = data.map(d => new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric'}));
    const revenues = data.map(d => Number(d.revenue));
    const sales = data.map(d => Number(d.sales));

    const perfCtx = document.getElementById('performanceChart');
    if (perfCtx) {
        if (performanceChartInstance) performanceChartInstance.destroy();
        
        performanceChartInstance = new Chart(perfCtx, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Sales count',
                    data: sales,
                    borderColor: '#4F46E5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    const revCtx = document.getElementById('revenueChart');
    if (revCtx) {
        if (revenueChartInstance) revenueChartInstance.destroy();

        revenueChartInstance = new Chart(revCtx, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Revenue USD',
                    data: revenues,
                    backgroundColor: '#10B981',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }
}


