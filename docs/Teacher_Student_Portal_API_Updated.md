# Teacher and Student Portal API Reference

Last updated: 2026-08-01

Live site tested: `https://pessjand.com/`

This document is the updated handoff for the app developer. It covers:

- Login credentials and auth flow
- Teacher portal endpoints
- Student portal endpoints
- JSON payload examples
- Notes about local-only vs API-backed modules

## 1) Base URL

Production:

```text
https://pessjand.com
```

Local testing:

```text
http://localhost:3000
```

All API routes are under:

```text
/api
```

## 2) Authentication

### Login endpoint

```http
POST /api/login
Content-Type: application/json
```

Example body:

```json
{
  "username": "USERNAME_OR_EMAIL",
  "password": "PASSWORD"
}
```

Successful response:

```json
{
  "success": true,
  "token": "JWT_TOKEN",
  "sessionId": "SESSION_ID",
  "permissions": {},
  "user": {
    "id": "user-id",
    "fullName": "Full Name",
    "role": "Teacher",
    "username": "username",
    "campusName": "Main Campus",
    "groupKey": "teacher"
  }
}
```

Send this header for protected APIs:

```http
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

### Verified live login examples

The live `/api/login` endpoint was tested successfully on `https://pessjand.com`.

Teacher sample login:

```json
{
  "username": "Teacherone",
  "password": "123"
}
```

Student sample login:

```json
{
  "username": "stu007",
  "password": "Student2578"
}
```

Teacher and student users log in through `/api/login` using the `username` and `password` stored in their database user record. Do not hardcode these values in the app.

## 3) Teacher Portal Modules

### Teacher dashboard and profile

| Module | Method | Endpoint | Notes |
|---|---|---|---|
| Login | POST | `/api/login` | Returns token and role |
| Profile intro | GET | `/api/teacher/me` | Logged-in teacher profile |
| Profile image update | POST | `/api/teacher/me` | Update `profileImage` |
| Class schedule / assignment | GET | `/api/teacher-class-assignments` | Assigned classes |
| Attendance | GET | `/api/teacher-attendance` | View attendance |
| Leave history | GET | `/api/leave-requests` | Teacher token required |
| Submit leave | POST | `/api/leave-requests` | Teacher token required |
| Messages | GET | `/api/messages` | Teacher token required |
| Notices | GET | `/api/special-notices?portal=teacher` | Teacher notices |
| Ads | GET | `/api/banners?placement=ad` | Portal ads |

### Teacher profile JSON example

```json
{
  "id": "TCH-1",
  "employeeCode": "EMP-001",
  "fullName": "Teacher Name",
  "fatherName": "Father Name",
  "dob": "1988-01-01",
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
  "schedule": "[]",
  "username": "teacher001",
  "plainPassword": "teacher-password",
  "role": "Teacher",
  "groupKey": "teacher"
}
```

### Teacher class assignment JSON example

```json
{
  "teacherId": "TCH-1",
  "teacherName": "Teacher Name",
  "teacherCampusName": "Main Campus",
  "classGrade": "Class 5",
  "campusName": "Main Campus",
  "note": "Morning section"
}
```

### Teacher attendance JSON example

```json
{
  "teacherId": "TCH-1",
  "date": "2026-08-01",
  "status": "Present"
}
```

### Teacher leave request JSON example

```json
{
  "fromDate": "2026-08-05",
  "toDate": "2026-08-07",
  "reason": "Sick leave",
  "fileName": "medical.pdf",
  "fileType": "application/pdf",
  "fileData": "data:application/pdf;base64,..."
}
```

### Teacher message JSON example

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

## 4) Student Portal Modules

### Student dashboard and profile

| Module | Method | Endpoint | Notes |
|---|---|---|---|
| Login | POST | `/api/login` | Returns token and role |
| Profile intro | GET | `/api/student/me` | Logged-in student profile |
| Profile image update | POST | `/api/student/me` | Update `profileImage` |
| Attendance | GET | `/api/student-attendance` | Attendance by student |
| Fee payments | GET | `/api/fees/payments` | Paid and partial payments |
| Due balances | GET | `/api/fees/due-balances` | Student dues |
| Teachers list | GET | `/api/teachers` | Teacher reference list |
| Messages | GET | `/api/messages` | Student token required |
| Complaints | GET/POST | `/api/complaints` | Student complaints |
| Complaint reply | POST | `/api/complaints/:id` | Add reply / update status |
| Leave requests | GET/POST/DELETE | `/api/leave-requests` | Student token required |
| Notices | GET | `/api/special-notices?portal=student` | Student notices |
| Date sheet | GET | `/api/date-sheet` | Exam schedule |
| Assignments | GET/POST | `/api/student-assignments` | Submission list / student upload |
| Diaries | GET/POST | `/api/student-diaries` | Class diary content |
| Courses | GET/POST | `/api/student-courses` | Course content |
| Quizzes | GET/POST | `/api/student-quizzes` | Quiz content |
| Uploaded assignments | GET/POST | `/api/uploaded-assignments` | Downloadable assignments |
| Uploaded lectures | GET/POST | `/api/uploaded-lectures` | Downloadable lectures |
| Ads | GET | `/api/banners?placement=ad` | Portal ads |

### Student profile JSON example

```json
{
  "id": "STU-1",
  "studentCode": "PESS-001",
  "fullName": "Student Name",
  "fatherName": "Father Name",
  "dob": "2015-01-01",
  "admissionDate": "2024-04-01",
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
  "plainPassword": "student-password",
  "role": "Student",
  "enrollmentStatus": "Active"
}
```

### Student attendance JSON example

```json
{
  "studentId": "STU-1",
  "date": "2026-08-01",
  "status": "Present"
}
```

### Complaint JSON example

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

### Complaint reply JSON example

```json
{
  "status": "Replied",
  "reply": "We have received your complaint.",
  "replyRole": "Admin",
  "replyName": "Admin",
  "actionTaken": "Forwarded to branch office"
}
```

### Leave request JSON example

```json
{
  "fromDate": "2026-08-05",
  "toDate": "2026-08-07",
  "reason": "Medical leave",
  "fileName": "medical.pdf",
  "fileType": "application/pdf",
  "fileData": "data:application/pdf;base64,..."
}
```

### Diary JSON example

```json
{
  "campusName": "Main Campus",
  "classGrade": "Class 1",
  "date": "2026-08-01",
  "title": "English",
  "details": "Chapter 1 homework"
}
```

### Course JSON example

```json
{
  "campusName": "Main Campus",
  "classGrade": "Class 1",
  "title": "English Course",
  "details": "Course details and notes",
  "file": {
    "name": "course.pdf",
    "type": "application/pdf",
    "dataUrl": "data:application/pdf;base64,..."
  }
}
```

### Quiz JSON example

```json
{
  "campusName": "Main Campus",
  "classGrade": "Class 1",
  "title": "Weekly Quiz",
  "totalMarks": "20",
  "passMarks": "10",
  "questions": [
    {
      "question": "What is 2 + 2?",
      "options": ["1", "2", "3", "4"],
      "answer": "4"
    }
  ],
  "file": {
    "name": "quiz.pdf",
    "type": "application/pdf",
    "dataUrl": "data:application/pdf;base64,..."
  }
}
```

### Uploaded assignment JSON example

```json
{
  "campusName": "Main Campus",
  "classGrade": "Class 1",
  "startDate": "2026-08-01",
  "dueDate": "2026-08-07",
  "totalMarks": "50",
  "passMarks": "25",
  "title": "Math Assignment",
  "details": "Solve chapter exercises",
  "file": {
    "name": "assignment.pdf",
    "type": "application/pdf",
    "dataUrl": "data:application/pdf;base64,..."
  }
}
```

### Student assignment submission JSON example

```json
{
  "studentId": "STU-1",
  "studentCode": "PESS-001",
  "studentName": "Student Name",
  "rollNo": "1",
  "campusName": "Main Campus",
  "classGrade": "Class 1",
  "sourceAssignmentId": "ASG-101",
  "assignmentTitle": "Math Homework",
  "subject": "Mathematics",
  "note": "Submitted from mobile app",
  "fileName": "homework.pdf",
  "fileType": "application/pdf",
  "fileData": "data:application/pdf;base64,...",
  "status": "Submitted"
}
```

Minimum required field:

```text
assignmentTitle
```

The current live backend accepts this payload at:

```http
POST /api/student-assignments
```

### Uploaded lecture JSON example

```json
{
  "campusName": "Main Campus",
  "classGrade": "Class 1",
  "title": "Science Lecture",
  "details": "Lecture notes",
  "file": {
    "name": "lecture.mp4",
    "type": "video/mp4",
    "dataUrl": "data:video/mp4;base64,..."
  }
}
```

### Banner / ad JSON example

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

## 5) Important Notes

1. `GET /api/teacher/me` is the correct teacher profile endpoint for the mobile teacher app.
2. `GET /api/student/me` is the correct student profile endpoint for the mobile student app.
3. Teacher and student login credentials are stored in the user database record and validated through `/api/login`.
4. File uploads are usually sent as `dataUrl` or `base64` strings in JSON.
5. Some modules can also work from local storage in the web portal, but mobile app should use the APIs listed above.
6. Use `Authorization: Bearer <token>` for portal-user protected routes.

## 6) Quick API Summary

### Teacher portal

```text
POST /api/login
GET  /api/teacher/me
POST /api/teacher/me
GET  /api/teacher-class-assignments
GET  /api/teacher-attendance
GET  /api/leave-requests
POST /api/leave-requests
GET  /api/messages
GET  /api/special-notices?portal=teacher
GET  /api/banners?placement=ad
```

### Student portal

```text
POST /api/login
GET  /api/student/me
POST /api/student/me
GET  /api/student-attendance
GET  /api/fees/payments
GET  /api/fees/due-balances
GET  /api/teachers
GET  /api/messages
GET  /api/complaints
POST /api/complaints
POST /api/complaints/:id
GET  /api/leave-requests
POST /api/leave-requests
DELETE /api/leave-requests/:id
GET  /api/special-notices?portal=student
GET  /api/date-sheet
GET  /api/student-assignments
POST /api/student-assignments
GET  /api/student-diaries
POST /api/student-diaries
GET  /api/student-courses
POST /api/student-courses
GET  /api/student-quizzes
POST /api/student-quizzes
GET  /api/uploaded-assignments
POST /api/uploaded-assignments
GET  /api/uploaded-lectures
POST /api/uploaded-lectures
GET  /api/banners?placement=ad
```

## 7) Live Test Notes

Tested on `2026-08-01` against `https://pessjand.com`.

Verified responses:

- `GET /api/health` returned `success: true`
- `GET /api/teachers` returned teacher records
- `GET /api/students` returned student records
- `POST /api/login` with `Teacherone / 123` returned a valid teacher token
- `POST /api/login` with `stu007 / Student2578` returned a valid student token

Important live observation:

- `GET /api/teachers` and `GET /api/students` currently expose `plainPassword` in the returned records. If this is for production mobile release, the backend should hide password fields before sharing the API with the app team.
