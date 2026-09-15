# AEGIS Demo Applicant Pack

**Name:** Mohammad Rehan
**Use:** Drop this PDF into the AEGIS extension (document vault) or paste the field list into My Profile Data. Then open TP08 and click Fill Form.

Fields marked **RESUME** come from Mohammad Rehan's real resume. Fields marked **DEMO** are synthetic extras so scholarship / KYC / checkout forms have something to fill. Identity numbers (Aadhaar, PAN, passport, card, UPI, bank) are **intentionally omitted** so the vault will not redact the whole pack, and so those fields stay empty on purpose.

---

## Contact (RESUME)

Full Name: Mohammad Rehan
First Name: Mohammad
Last Name: Rehan
Email: mohammadrehan432432@gmail.com
Phone: 8008667486
City: Bangalore
State: Karnataka
Country: India
Nationality: Indian
Website: https://rehandev.live
GitHub: https://github.com/MrEGAMERZ

---

## Education (RESUME)

College: Presidency University
Course: B.Tech Computer Science
Branch: Computer Science
Year of Study: 2
Roll Number: CSE2025B142
Occupation: Student
Job Title: GenAI Developer Intern
Organization: Lensara Technology

Presidency University, Bangalore, B.Tech Computer Science, 2025 to 2029, GPA 3.0.
Senior Secondary (Class 12), Kuwait, 80%.

---

## Address and family (DEMO)

These are invented for the live demo. They are not real family or street details.

Date of Birth: 2006-03-22
Gender: Male
Address: 42, 2nd Main, Yelahanka New Town
Address Line 2: Near Mother Dairy
PIN Code: 560064
Father's Name: Imran Ahmed
Mother's Name: Sameera Begum
Guardian Name: Imran Ahmed
Emergency Contact: Imran Ahmed
Blood Group: B+
Annual Income: 480000
Languages: English, Hindi, Arabic

---

## Project to paste into open-ended fields (RESUME)

Project description: Built AEGIS, an on-device visual perception and PII redaction layer for AI browser agents using BlazeFace, DistilBERT NER, regex, ONNX/WASM, and canvas masking. Sanitized visual context is sent to a VLM while sensitive data stays on the device.

---

## How this maps to the demo pages

| Page | What should fill from this pack | What must stay empty |
|---|---|---|
| TP01 Login | Email | Password |
| TP02 Payment | Cardholder Name, Street Address, City, PIN Code | Card Number, CVV |
| TP03 Profile | Name, Email, Phone, Location, DOB (if filling) | n/a (mostly redaction) |
| TP04 Healthcare | n/a (redaction of on-page patient PII) | n/a |
| TP05 Dashboard | n/a (redaction of employee/bank/API secrets) | Admin password |
| TP06 Checkout | Email, Full Name, Street, City, PIN, Phone | Password, OTP, card, UPI, Aadhaar last-4 |
| TP07 KYC | Full Name, Date of Birth, Gender, Mobile, Address | Aadhaar, PAN, PIN |
| TP08 Kitchen-sink | Name, email, phone, DOB, gender, job, org, address, city, state, PIN, parents, college, course, year, project | Aadhaar, PAN, blood group can fill (DEMO), portal PIN, card, CVV |

Suggested Fill Form task:

Fill the scholarship application using my saved profile and uploaded document. Leave blank any field that is not in the profile. Do not invent Aadhaar, PAN, card numbers, passwords, or PINs.
