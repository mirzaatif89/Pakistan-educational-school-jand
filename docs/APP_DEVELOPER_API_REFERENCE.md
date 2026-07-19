# PESS JAND App Developer API Reference

This file is the single handoff reference for building a mobile app against this project.

Verified from:
- `app.js` loads `backend/core.js` for the live Express server.
- `api/` contains Vercel/serverless-style API copies.
- `backend/api/` contains extra modular handlers used by some frontend pages but not automatically mounted by `app.js`.

## Base URL

Use the deployed domain as the base URL:

```text
https://YOUR-DOMAIN.com
```

For local testing:

```text
http://localhost:3000
```

API paths are under `/api`.

## Authentication

Login:

```http
POST /api/login
Content-Type: application/json

{
  "username": "USERNAME_OR_EMAIL",
  "password": "PASSWORD"
}
```

Success response:

```json
{
  "success": true,
  "token": "JWT_TOKEN",
  "sessionId": "SESSION_ID",
  "permissions": {},
  "user": {
    "id": "student-or-teacher-id",
    "fullName": "Name",
    "role": "Student",
    "username": "username",
    "campusName": "Campus",
    "groupKey": "student"
  }
}
```

For protected APIs send:

```http
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

Roles used by the system:

```text
Admin, Principal, Branch, Student, Teacher, Staff
```

## Live Express APIs

These routes are present in `backend/core.js`, which is loaded by `app.js`.

### Health

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | No | Server health |
| GET | `/api/health` | No | API health |
| GET | `/api/ping` | No | API ping |

### Auth And Sessions

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/login` | No | Login admin, principal, student, teacher, staff |
| POST | `/api/session/heartbeat` | Yes | Keep session active |
| POST | `/api/session/end` | Yes | End current session |
| GET | `/api/active-sessions` | Admin | List active sessions |
| DELETE | `/api/active-sessions/:sessionId` | Admin | Force logout one session |
| POST | `/api/active-sessions/logout` | Admin | Force logout by posted session id |

### Students

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/students` | No | List all students |
| POST | `/api/students` | Yes | Add/update one or many students |
| DELETE | `/api/students/:id` | Yes | Delete student |
| GET | `/api/student/me` | Student | Current logged-in student profile |

Student object fields:

```json
{
  "id": "STU-1",
  "studentCode": "PESS-001",
  "fullName": "Student Name",
  "profileImage": "data:image/...",
  "fatherName": "Father Name",
  "dob": "YYYY-MM-DD",
  "admissionDate": "YYYY-MM-DD",
  "classGrade": "Class 1",
  "campusName": "Main Campus",
  "gender": "Male",
  "parentPhone": "03000000000",
  "email": "student@example.com",
  "address": "Address",
  "rollNo": "1",
  "formB": "00000-0000000-0",
  "monthlyFee": "2000",
  "remainingAmount": "0",
  "feeFrequency": "Monthly",
  "feesStatus": "Pending",
  "username": "student001",
  "password": "plain-or-hash-on-save",
  "plainPassword": "student-password",
  "role": "Student",
  "enrollmentStatus": "Active"
}
```

### Teachers

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/teachers` | No | List all teachers |
| POST | `/api/teachers` | Yes | Add/update one or many teachers |
| DELETE | `/api/teachers/:id` | Yes | Delete teacher |
| GET | `/api/teacher/me` | Teacher token | Current logged-in teacher profile/intro |
| POST | `/api/teacher/me` | Teacher token | Update current logged-in teacher profile image |

Teacher object fields:

```json
{
  "id": "TCH-1",
  "employeeCode": "EMP-001",
  "fullName": "Teacher Name",
  "profileImage": "data:image/...",
  "fatherName": "Father Name",
  "dob": "YYYY-MM-DD",
  "cnic": "00000-0000000-0",
  "phone": "03000000000",
  "email": "teacher@example.com",
  "address": "Address",
  "qualification": "MA/MSc",
  "campusName": "Main Campus",
  "gender": "Female",
  "designation": "Teacher",
  "subject": "English",
  "salary": "50000",
  "bankName": "Bank",
  "bankAccountTitle": "Teacher Name",
  "bankAccountNumber": "123456",
  "bankBranch": "Branch",
  "schedule": "JSON string or array before save",
  "username": "teacher001",
  "password": "plain-or-hash-on-save",
  "plainPassword": "teacher-password",
  "groupKey": "teacher",
  "role": "Teacher"
}
```

Teacher intro/profile response:

```http
GET /api/teacher/me
Authorization: Bearer TEACHER_TOKEN
```

Returns the teacher record without `password`. Use this endpoint directly in the mobile teacher portal; do not depend on filtering `/api/teachers` by id.

Update teacher profile photo:

```http
POST /api/teacher/me
Authorization: Bearer TEACHER_TOKEN
Content-Type: application/json
```

```json
{
  "profileImage": "data:image/png;base64,..."
}
```

### Staff

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/staff` | No | List all staff |
| POST | `/api/staff` | Yes | Add/update one or many staff records |
| DELETE | `/api/staff/:id` | Yes | Delete staff |

Staff fields are similar to teacher fields but without `subject` and `schedule`.

### Attendance

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/student-attendance` | No | Get attendance grouped by student id |
| POST | `/api/student-attendance` | No | Save one or many student attendance rows |
| GET | `/api/teacher-attendance` | No | Get attendance grouped by teacher id |
| POST | `/api/teacher-attendance` | No | Save one or many teacher attendance rows |

Student attendance POST:

```json
{
  "studentId": "STU-1",
  "date": "2026-07-16",
  "status": "Present"
}
```

Teacher attendance POST:

```json
{
  "teacherId": "TCH-1",
  "date": "2026-07-16",
  "status": "Present"
}
```

Valid statuses used by UI include:

```text
Present, Absent, Late, Leave, Not Marked
```

### Messages

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/messages` | Yes | Admin sees all; students/teachers/staff see their own matching messages |
| GET | `/api/messages?role=Student` | Admin/Principal | Filter messages by target role |
| POST | `/api/messages` | Admin/Principal | Send message to portal users |

POST body:

```json
{
  "targetRole": "Teacher",
  "targetScope": "individual",
  "campusName": "Main Campus",
  "classGrade": "",
  "recipientId": "TCH-1",
  "recipientName": "Teacher Name",
  "subject": "Meeting",
  "body": "Please check your timetable."
}
```

Rules:

```text
targetRole: Student | Teacher | Staff
targetScope: all | campus | class | individual
class scope is only for Student and requires campusName + classGrade.
individual scope requires recipientId.
```

### Complaints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/complaints` | No in current core | List all complaints |
| GET | `/api/complaints?role=Student` | No in current core | List student complaints |
| GET | `/api/complaints?role=Teacher` | No in current core | List teacher complaints |
| GET | `/api/complaints?role=Family` | No in current core | List parent/family complaints |
| POST | `/api/complaints` | No in current core | Submit a complaint |
| POST | `/api/complaints/:id` | No in current core | Update status, reply, or action taken |
| DELETE | `/api/complaints/:id` | No in current core | Delete complaint |

Submit complaint:

```json
{
  "senderRole": "Student",
  "senderId": "STU-1",
  "senderName": "Student Name",
  "senderClass": "Class 1",
  "campusName": "Main Campus",
  "subject": "Bus issue",
  "message": "Complaint details",
  "file": {
    "name": "proof.jpg",
    "type": "image/jpeg",
    "dataUrl": "data:image/jpeg;base64,..."
  }
}
```

For parent/family complaints, send:

```json
{
  "senderRole": "Family",
  "senderName": "Parent Name",
  "senderClass": "03000000000",
  "subject": "Complaint subject",
  "message": "Complaint details"
}
```

Update/reply:

```json
{
  "status": "Replied",
  "reply": "We have received your complaint.",
  "replyRole": "Admin",
  "replyName": "Admin",
  "actionTaken": "Forwarded to branch office"
}
```

Valid statuses:

```text
Pending, In Progress, Replied, Resolved, Closed
```

### Leave Requests

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/leave-requests` | Student/Teacher/Admin/Staff | Portal users see own leaves; reviewers see all |
| GET | `/api/leave-requests?role=Student` | Admin/Staff | Student leave review queue |
| GET | `/api/leave-requests?role=Teacher` | Admin/Staff | Teacher leave review queue |
| POST | `/api/leave-requests` | Student/Teacher | Create own leave request |
| POST | `/api/leave-requests/:id` | Admin/Staff | Approve/reject leave request |
| DELETE | `/api/leave-requests/:id` | Owner/Admin/Staff | Delete own pending request, or reviewer delete |

Create leave request:

```json
{
  "fromDate": "2026-07-16",
  "toDate": "2026-07-18",
  "reason": "Sick leave",
  "fileName": "medical.pdf",
  "fileType": "application/pdf",
  "fileData": "data:application/pdf;base64,..."
}
```

Review leave:

```json
{
  "status": "Approved",
  "reviewReason": ""
}
```

### Special Notices

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/special-notices` | No | List all notices |
| GET | `/api/special-notices?portal=student` | No | Executed student notices |
| GET | `/api/special-notices?portal=teacher` | No | Executed teacher notices |
| POST | `/api/special-notices` | No in current core | Create/update notice |
| DELETE | `/api/special-notices/:id` | No in current core | Delete notice |

POST body:

```json
{
  "id": "NOTICE-optional",
  "title": "Notice title",
  "message": "Notice message",
  "targetPortals": ["student", "teacher"],
  "status": "executed"
}
```

### Banners And Mobile App Ads

Admin sidebar has `Banners` and `Ads` options. Both save through the same API; the difference is `placement`.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/banners` | No | List all saved banners and ads |
| GET | `/api/banners?placement=ad` | No | List only mobile app/student/teacher portal ads |
| GET | `/api/banners?placement=banner` | No | List only website banners |
| POST | `/api/banners` | No in current core | Create/update banner or ad |
| DELETE | `/api/banners/:id` | No in current core | Delete banner or ad |

Mobile app ads request:

```http
GET /api/banners?placement=ad
```

Only show records where `isActive !== false`, `placement === "ad"`, and `imageUrl` is present.

Create/update ad:

```json
{
  "id": "BANNER-optional",
  "title": "Admissions Open",
  "subtitle": "Optional text",
  "imageUrl": "data:image/png;base64,... or https://...",
  "linkUrl": "https://example.com/ad-page",
  "placement": "ad",
  "displayOrder": 1,
  "isActive": true
}
```

### Online Admissions

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/online-admissions` | No | List admission applications |
| POST | `/api/online-admissions` | No | Submit admission application |
| POST | `/api/online-admissions/:id` | No | Update application/status |
| DELETE | `/api/online-admissions/:id` | No | Delete application |

POST body:

```json
{
  "studentName": "Student Name",
  "parentName": "Parent Name",
  "className": "Class 1",
  "phone": "03000000000",
  "email": "parent@example.com",
  "campus": "Main Campus",
  "studentAge": "5",
  "previousSchool": "Previous School",
  "address": "Address",
  "message": "Optional message"
}
```

Required:

```text
studentName, parentName, className, phone
```

### Date Sheet

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/date-sheet` | No | Get current date sheet |
| POST | `/api/date-sheet` | No in current core | Save date sheet |

POST body:

```json
{
  "dateSheetSchoolName": "PESS JAND",
  "dateSheetExamTitle": "Final Term",
  "dateSheetSession": "2026",
  "dateSheetClassGroup": "Class 1",
  "dateSheetCampus": "Main Campus",
  "dateSheetDefaultStart": "09:00",
  "dateSheetInstructions": "Bring roll number slip.",
  "status": "executed",
  "scheduleRows": [
    {
      "subject": "English",
      "className": "Class 1",
      "examDate": "2026-08-01",
      "startTime": "09:00",
      "endTime": "12:00"
    }
  ]
}
```

### Fees

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/class-fees` | No | List class fee settings |
| POST | `/api/class-fees` | Yes | Replace class fee settings |
| POST | `/api/fees/challan-token` | No | Create one challan payment token |
| POST | `/api/fees/challan-tokens` | No | Create many challan payment tokens |
| POST | `/api/fees/manual-payment` | No | Mark manual fee payment |
| GET | `/api/fees/payments` | No | List paid/partial payments |
| POST | `/api/fees/mark-unpaid` | No | Void payment and add due balance |
| GET | `/api/fees/due-balances` | No | Due balance by student id |
| GET | `/api/fees/pay/:token` | No | Public fee payment confirmation page |

Class fees POST:

```json
[
  {
    "className": "Class 1",
    "monthlyFee": 2000,
    "feeFrequency": "Monthly"
  }
]
```

Manual payment POST:

```json
{
  "studentId": "STU-1",
  "studentName": "Student Name",
  "rollNo": "1",
  "classGrade": "Class 1",
  "feeMonth": "July",
  "feeMonths": ["July"],
  "challanNumber": "CH-001",
  "amount": 2000,
  "fullAmount": 2000,
  "status": "Paid",
  "session": "2026"
}
```

Mark unpaid POST:

```json
{
  "studentId": "STU-1",
  "feeMonth": "July",
  "challanNumbers": ["CH-001"]
}
```

### Branches

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/branches` | No | List campuses/branches |
| POST | `/api/branches` | No in current core | Add/update branch |
| DELETE | `/api/branches/:id` | No in current core | Delete branch |

Branch POST:

```json
{
  "id": "BR-1",
  "campusName": "Main Campus",
  "username": "branch-main",
  "password": "password",
  "plainPassword": "password"
}
```

### Permissions And Admin Settings

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/permissions` | No | Load role/login permissions |
| POST | `/api/permissions` | Admin token | Save role/login permissions |
| GET | `/api/designation-permissions` | Yes | List designation permissions |
| GET | `/api/designation-permissions?designation=teacher` | Yes | Get one designation |
| GET | `/api/designation-permissions?designation=teacher&action=students.view` | Yes | Check one action |
| POST | `/api/designation-permissions` | Admin token | Save designation permissions |
| GET | `/api/admin-credentials` | Admin token | Get admin username only |
| POST | `/api/admin-credentials` | Admin token | Change admin username/password |

### Email And AI

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/email/config` | Yes | SMTP config status |
| POST | `/api/email/send` | Yes | Send SMTP email |
| POST | `/api/ai-chat` | Yes | Ask AI chat helper |

Email POST:

```json
{
  "to": "person@example.com",
  "subject": "Subject",
  "text": "Plain message",
  "html": "<p>HTML message</p>"
}
```

AI chat POST:

```json
{
  "message": "How many students are pending fee?"
}
```

### Reset

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/reset-data` | Admin | Deletes operational data |

Do not use this in the mobile app except for a protected admin-only maintenance screen.

## Extra API Handlers In `backend/api/`

These files exist in the project but are not automatically mounted by root `app.js` unless hosting/server code maps them. If the mobile app needs them on the current live Express deployment, add equivalent routes to `backend/core.js` or mount these handlers.

| Method | Endpoint | Purpose |
|---|---|---|
| GET/POST | `/api/student/me` | Student profile; POST updates student profile image |
| GET/POST | `/api/student-assignments` | Assignment submissions |
| POST | `/api/fees/fine-charge` | Add fine payment |
| PUT/DELETE | `/api/fees/payments/:challanNumber` | Update/delete fee payment |
| POST | `/api/fees/send-pending-reminders` | Send pending fee reminders |
| POST | `/api/email/execute-all` | Execute all email notification jobs |
| POST | `/api/email/send-birthday-greetings` | Send birthday emails |
| GET/POST | `/api/library/issues` | Library issue records |
| POST/DELETE | `/api/library/issue-action` | Return/delete library issue |
| POST | `/api/library/issue-action?id=:id` | Return one library issue |
| DELETE | `/api/library/issue-action?id=:id` | Delete one library issue |
| GET/POST | `/api/cafe/contracts` | Cafe contracts |
| DELETE | `/api/cafe/contracts/:id` | Delete cafe contract |
| GET/POST | `/api/transport/assignments` | Transport assignments |
| DELETE | `/api/transport/assignments/:id` | Delete transport assignment |
| GET | `/api/revenue` | Revenue summary |
| POST | `/api/admin-credentials/request-otp` | Admin credential OTP request |
| POST | `/api/admin-credentials/verify-otp` | Admin credential OTP verify |
| POST | `/api/admin-password/forgot/request-otp` | Forgot password OTP |
| POST | `/api/admin-password/forgot/reset` | Reset admin password |

### Leave Requests

Create leave request:

```http
POST /api/leave-requests
Authorization: Bearer STUDENT_OR_TEACHER_TOKEN
```

```json
{
  "fromDate": "2026-07-16",
  "toDate": "2026-07-18",
  "reason": "Sick leave",
  "fileName": "medical.pdf",
  "fileType": "application/pdf",
  "fileData": "data:application/pdf;base64,..."
}
```

Review leave:

```http
POST /api/leave-requests/:id
Authorization: Bearer ADMIN_OR_STAFF_TOKEN
```

```json
{
  "status": "Approved",
  "reviewReason": ""
}
```

For rejection:

```json
{
  "status": "Rejected",
  "reviewReason": "Reason is required for rejection"
}
```

### Student Assignment Submission

```http
POST /api/student-assignments
Content-Type: application/json
```

```json
{
  "studentId": "STU-1",
  "studentCode": "PESS-001",
  "studentName": "Student Name",
  "rollNo": "1",
  "classGrade": "Class 1",
  "assignmentTitle": "Math Homework",
  "subject": "Math",
  "note": "Completed",
  "fileName": "homework.pdf",
  "fileType": "application/pdf",
  "fileData": "data:application/pdf;base64,..."
}
```

Required:

```text
assignmentTitle
```

### Profile Image Update

Student:

```http
POST /api/student/me
Authorization: Bearer STUDENT_TOKEN
```

Teacher:

```http
POST /api/teacher/me
Authorization: Bearer TEACHER_TOKEN
```

Body:

```json
{
  "profileImage": "data:image/png;base64,..."
}
```

## Serverless `api/` Folder Routes

The root `api/` folder has these route files:

```text
GET              /api/health
GET              /api
POST             /api/login
GET,POST         /api/admin-credentials
GET,POST         /api/branches
DELETE           /api/branches/:id
GET,POST         /api/date-sheet
GET,POST         /api/designation-permissions
GET              /api/designation-permissions?designation=:designation
GET              /api/designation-permissions?designation=:designation&action=:module.:action
GET              /api/email/config
POST             /api/email/send
GET              /api/fees
POST             /api/fees/challan-token
POST             /api/fees/challan-tokens
GET              /api/fees/due-balances
POST             /api/fees/manual-payment
GET              /api/fees/pay/:token
GET,POST         /api/messages
GET,POST         /api/online-admissions
POST,DELETE      /api/online-admissions/:id
GET,POST         /api/permissions
POST             /api/reset-data
GET,POST         /api/special-notices
DELETE           /api/special-notices/:id
GET,POST         /api/staff
DELETE           /api/staff/:id
GET,POST         /api/student/me
GET,POST         /api/student-attendance
GET,POST         /api/students
DELETE           /api/students/:id
GET,POST         /api/teacher/me
GET,POST         /api/teacher-attendance
GET,POST         /api/teachers
DELETE           /api/teachers/:id
GET,POST         /api/banners
DELETE           /api/banners/:id
GET,POST         /api/complaints
POST,DELETE      /api/complaints/:id
```

## Referenced But Not Implemented In Current Backend Scan

These URLs appear in older docs or frontend references, but no matching active handler was found in `backend/core.js`, `api/`, or `backend/api/` during this scan.

| Referenced endpoint | Status | What to do |
|---|---|---|
| `/api/teacher-salaries` | Referenced by `frontend/script.js`, no backend handler found | Use salary fields from `/api/teachers`, or implement this route before mobile app uses it |
| `/api/class-fees/history/:id` | Referenced by `frontend/script.js` and old docs, no backend handler found | Use `/api/class-fees` history payload if available, or implement PUT/DELETE history route |
| `/api/library/issues/:id` | Old docs alias, no matching file route found | Use `DELETE /api/library/issue-action?id=:id` from `backend/api/library/issue-action.js` |
| `/api/library/issues/:id/return` | Old docs alias, no matching file route found | Use `POST /api/library/issue-action?id=:id` from `backend/api/library/issue-action.js` |

## Realtime Socket Events

The web app emits Socket.IO events after changes. Mobile apps can either poll REST APIs or connect to Socket.IO.

Events used in active backend:

```text
students_update
teachers_update
staff_update
student_attendance_update
teacher_attendance_update
class_fees_update
fee_payment_update
messages_update
special_notices_update
date_sheet_update
online_admissions_update
reset_data
```

## Recommended Mobile App Screens

Student app:

```text
Login
Profile: GET /api/student/me
Attendance: GET /api/student-attendance, filter by student id
Fees: GET /api/fees/payments, GET /api/fees/due-balances, GET /api/students for fee status
Messages: GET /api/messages
Complaints: GET/POST /api/complaints
Notices: GET /api/special-notices?portal=student
Date sheet: GET /api/date-sheet
Leave: /api/leave-requests if exposed from backend/api
Assignments: /api/student-assignments if exposed from backend/api
```

Teacher app:

```text
Login
Profile/intro: GET /api/teacher/me
Profile photo: POST /api/teacher/me
Attendance: GET /api/teacher-attendance, filter by teacher id
Schedule: GET /api/teachers and parse teacher.schedule
Messages: GET /api/messages
Complaints: GET/POST /api/complaints
Notices: GET /api/special-notices?portal=teacher
Leave: GET/POST /api/leave-requests
Ads: GET /api/banners?placement=ad
```

Admin app:

```text
Dashboard data: GET /api/students, /api/teachers, /api/staff
Admissions: /api/online-admissions
Messages: /api/messages
Complaints: /api/complaints
Notices: /api/special-notices
Fees: /api/class-fees, /api/fees/payments, /api/fees/due-balances
Attendance: /api/student-attendance, /api/teacher-attendance
```

## Important Implementation Notes

1. Use `Authorization: Bearer <token>` for all portal user APIs.
2. Some admin/config routes in `backend/core.js` currently do not enforce auth; mobile app should still protect those screens client-side and the backend should be hardened before public mobile release.
3. `GET /api/students`, `GET /api/teachers`, and `GET /api/staff` return full records including login-related fields. Do not show passwords in a mobile app except in admin screens.
4. File uploads are stored as base64/data URLs in JSON fields such as `profileImage`, `fileData`, `idCardFront`, `idCardBack`, and `cvFile`.
5. Teacher `schedule` may be stored as a JSON string. Mobile developer should parse safely:

```js
const schedule = Array.isArray(teacher.schedule)
  ? teacher.schedule
  : JSON.parse(teacher.schedule || "[]");
```

6. `GET /api/teacher/me` is the required teacher intro/profile endpoint for the mobile teacher app.
7. `GET /api/banners?placement=ad` is the required mobile ad endpoint for student and teacher app screens.
