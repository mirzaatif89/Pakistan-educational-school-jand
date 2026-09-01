from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

out = 'docs/Student_Portal_Diary_Syllabus_Quiz_APIs.docx'
doc = Document()
doc.styles['Normal'].font.name = 'Arial'
doc.styles['Normal'].font.size = Pt(10)
title = doc.add_heading('Student Portal APIs', 0)
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
p = doc.add_paragraph('Diary, Syllabus/Class Course and Quiz APIs\nPESS JAND | Tested: 01 September 2026')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
doc.add_heading('Base URL and headers', 1)
doc.add_paragraph('Local: http://localhost:3000/api\nProduction: replace with your deployed domain followed by /api\nUse Content-Type: application/json for POST. Student feed requires Authorization: Bearer <student_token>.')
doc.add_heading('Endpoint summary', 1)
t = doc.add_table(rows=1, cols=4); t.style = 'Table Grid'
for c, v in zip(t.rows[0].cells, ['Module','Method','Endpoint','Purpose']): c.text = v
rows = [
 ('Class options','GET','/class-options?campus=Main%20Campus','Classes for dropdown'),
 ('Diary','GET','/student-diaries','Read diaries'), ('Diary','POST','/student-diaries','Create/update diary'), ('Diary','DELETE','/student-diaries?id=DIARY_ID','Delete diary'),
 ('Syllabus/Course','POST','/student-courses/file','Upload syllabus file (raw binary)'), ('Syllabus/Course','GET','/student-courses?campus=Main%20Campus&classGrade=Play%20Group','Read syllabus'), ('Syllabus/Course','POST','/student-courses','Create/update syllabus'), ('Syllabus/Course','DELETE','/student-courses?id=COURSE_ID','Delete syllabus'),
 ('Quiz','GET','/student-quizzes?campus=Main%20Campus&classGrade=Play%20Group','Read quizzes'), ('Quiz','POST','/student-quizzes','Create/update quiz'), ('Quiz','DELETE','/student-quizzes?id=QUIZ_ID','Delete quiz'),
 ('Student feed','GET','/student-portal/content','Authenticated matching feed')]
for row in rows:
    cells = t.add_row().cells
    for c, v in zip(cells, row): c.text = v

def code(label, value):
    doc.add_heading(label, 2)
    p = doc.add_paragraph(); r = p.add_run(value); r.font.name = 'Consolas'; r.font.size = Pt(8)

doc.add_heading('JSON examples', 1)
code('Diary POST', '{ "campusName":"Main Campus", "classGrade":"Play Group", "date":"2026-09-01", "title":"English", "details":"Learn chapter 1" }')
code('Diary response', '{ "success":true, "diaries":[{"id":"DIARY-...","campusName":"Main Campus","classGrade":"Play Group","date":"2026-09-01","title":"English","details":"Learn chapter 1","file":null,"createdAt":"ISO_DATE","updatedAt":"ISO_DATE"}] }')
code('Syllabus/Course POST', '{ "campusName":"Main Campus", "classGrade":"Play Group", "title":"Mathematics", "details":"Chapters 1-3", "file":{"name":"syllabus.pdf","type":"application/pdf","url":"/uploads/file.pdf"} }')
code('Course response', '{ "success":true, "course":{"id":"COURSE-...", "campusName":"Main Campus", "classGrade":"Play Group", "title":"Mathematics", "details":"Chapters 1-3", "file":{...}}, "courses":[...] }')
code('Quiz POST', '{ "campusName":"Main Campus", "classGrade":"Play Group", "title":"Weekly Quiz", "totalMarks":"20", "passMarks":"10", "dueDate":"2026-09-07", "questions":[{"text":"2 + 2 = ?","options":["3","4","5","6"],"correctIndex":1,"marks":5}] }')
code('Quiz response', '{ "success":true, "quiz":{"id":"QUIZ-...", "campusName":"Main Campus", "classGrade":"Play Group", "title":"Weekly Quiz", "totalMarks":"20", "passMarks":"10", "questions":[...]}, "quizzes":[...] }')
code('Student feed', 'GET /api/student-portal/content\nAuthorization: Bearer <student_token>\n\n{ "success":true, "student":{ "classGrade":"Play Group", "campusName":"Main Campus" }, "diaries":[...], "courses":[...], "quizzes":[...] }')
doc.add_heading('Validation rules', 1)
doc.add_paragraph('Diary: campusName, classGrade, date, title and details required. Course: campusName, classGrade, title and details required. Quiz: campusName, classGrade, title, totalMarks, passMarks and questions or file required. Existing id updates a record; omit id to create.')
doc.add_heading('Verified test results', 1)
for item in ['GET /api/health — 200 OK','GET /api/class-options — 200 OK (Play Group returned)','GET /api/student-diaries — 200 OK','GET /api/student-courses — 200 OK','GET /api/student-quizzes — 200 OK','GET /api/student-portal/content without token — 401 Unauthorized (expected)','POST diary/course/quiz with {} — 400 validation (expected)']:
    doc.add_paragraph(item, style='List Bullet')
doc.add_paragraph('For files, first upload through the course file-upload endpoint, then include the returned URL in the course JSON.')
doc.save(out)
print(out)
