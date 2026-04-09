(function () {
    const currentPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const publicPages = new Set(['index.html', '']);
    const adminPages = new Set([
        'dashboard.html',
        'students.html',
        'teachers.html',
        'staff.html',
        'classes.html',
        'fees.html',
        'fee_challan.html',
        'teacher_salaries.html',
        'finance.html',
        'exams.html',
        'revenue.html',
        'aboutme.html',
        'settings.html',
        'permissions.html',
        'branch_registration.html',
        'email.html'
    ]);
    const teacherPages = new Set(['teacher_portal.html']);
    const studentPages = new Set(['student_portal.html']);
    const staffPages = new Set(['staff_portal.html']);
    const principalPages = new Set(['principal_portal.html']);
    const branchPages = new Set(['students.html']);

    const rawUser = sessionStorage.getItem('loggedInUser');
    const authToken = sessionStorage.getItem('eduCore_token');
    let loggedInUser = null;

    try {
        loggedInUser = rawUser ? JSON.parse(rawUser) : null;
    } catch (error) {
        loggedInUser = null;
    }

    function redirectToAllowedHome(role) {
        if (role === 'Admin') {
            window.location.replace('dashboard.html');
            return;
        }

        if (role === 'Teacher') {
            window.location.replace('teacher_portal.html');
            return;
        }

        if (role === 'Student') {
            window.location.replace('student_portal.html');
            return;
        }

        if (role === 'Branch') {
            window.location.replace('students.html');
            return;
        }

        if (role === 'Staff') {
            window.location.replace('staff_portal.html');
            return;
        }

        if (role === 'Principal') {
            window.location.replace('principal_portal.html');
            return;
        }

        window.location.replace('index.html');
    }

    function forceLoginRedirect() {
        sessionStorage.removeItem('loggedInUser');
        sessionStorage.removeItem('eduCore_token');
        sessionStorage.removeItem('eduCore_student_profile');
        window.location.replace('index.html');
    }

    if (publicPages.has(currentPage)) {
        if (loggedInUser && authToken) {
            redirectToAllowedHome(loggedInUser.role);
        }
        return;
    }

    if (!loggedInUser || !authToken) {
        forceLoginRedirect();
        return;
    }

    if (currentPage === 'students.html' && (loggedInUser.role === 'Admin' || loggedInUser.role === 'Branch')) {
        return;
    }

    if (adminPages.has(currentPage) && loggedInUser.role !== 'Admin') {
        redirectToAllowedHome(loggedInUser.role);
        return;
    }

    if (teacherPages.has(currentPage) && loggedInUser.role !== 'Teacher') {
        redirectToAllowedHome(loggedInUser.role);
        return;
    }

    if (studentPages.has(currentPage) && loggedInUser.role !== 'Student') {
        redirectToAllowedHome(loggedInUser.role);
        return;
    }

    if (staffPages.has(currentPage) && loggedInUser.role !== 'Staff') {
        redirectToAllowedHome(loggedInUser.role);
        return;
    }

    if (principalPages.has(currentPage) && loggedInUser.role !== 'Principal') {
        redirectToAllowedHome(loggedInUser.role);
        return;
    }

    if (branchPages.has(currentPage) && loggedInUser.role !== 'Branch') {
        redirectToAllowedHome(loggedInUser.role);
    }
})();

function logoutUser(event) {
    if (event) event.preventDefault();
    sessionStorage.removeItem('loggedInUser');
    sessionStorage.removeItem('eduCore_token');
    sessionStorage.removeItem('eduCore_student_profile');
    window.location.href = 'index.html';
}
