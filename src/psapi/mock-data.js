const srisukChildren = [
    {
      student_powerschool_id: 'S1001',
      name: 'Niran Srisuk',
      nickname: 'Nin',
      grade: '5',
      teachers: [
        { powerschool_teacher_id: 'T1001', room: '204' },
        { powerschool_teacher_id: 'T1002', room: '118' },
      ],
    },
    {
      student_powerschool_id: 'S1002',
      name: 'Malee Srisuk',
      nickname: 'May',
      grade: '2',
      teachers: [
        { powerschool_teacher_id: 'T1004', room: '112' },
      ],
    },
];

export const MOCK_GUARDIANS = {
  'parent@nis.ac.th': srisukChildren,
  'father@example.com': srisukChildren,
};

export const MOCK_SCHOOLS = [
  { powerschool_school_id: '1', name: 'Elementary' },
  { powerschool_school_id: '2', name: 'Middle' },
  { powerschool_school_id: '3', name: 'High' },
];

export const MOCK_TEACHERS = [
  {
    powerschool_teacher_id: 'T1001',
    display_name: 'Aroon Srisuk',
    email: 'aroon.srisuk@nis.ac.th',
    photo_url: null,
    room: '204',
    powerschool_school_id: '1',
  },
  {
    powerschool_teacher_id: 'T1002',
    display_name: 'Maya Chen',
    email: 'maya.chen@nis.ac.th',
    photo_url: null,
    room: '118',
    powerschool_school_id: '1',
  },
  {
    powerschool_teacher_id: 'T1003',
    display_name: 'Daniel Okonkwo',
    email: 'daniel.okonkwo@nis.ac.th',
    photo_url: null,
    room: '310',
    powerschool_school_id: '3',
  },
  {
    powerschool_teacher_id: 'T1004',
    display_name: 'Priya Nair',
    email: 'priya.nair@nis.ac.th',
    photo_url: null,
    room: '112',
    powerschool_school_id: '1',
  },
  {
    powerschool_teacher_id: 'T1005',
    display_name: 'Luca Moretti',
    email: 'luca.moretti@nis.ac.th',
    photo_url: null,
    room: 'Gym',
    powerschool_school_id: '2',
  },
  {
    powerschool_teacher_id: 'T1006',
    display_name: 'Hanae Fujita',
    email: 'hanae.fujita@nis.ac.th',
    photo_url: null,
    room: '221',
    powerschool_school_id: '2',
  },
  {
    powerschool_teacher_id: 'T1007',
    display_name: 'Samuel Brooks',
    email: 'samuel.brooks@nis.ac.th',
    photo_url: null,
    room: '205',
    powerschool_school_id: '3',
  },
  {
    powerschool_teacher_id: 'T1008',
    display_name: 'Chanya Wattana',
    email: 'chanya.wattana@nis.ac.th',
    photo_url: null,
    room: '109',
    powerschool_school_id: '1',
  },
];

// Same shape as the live guardian chain: email address → person → student
// contact → active contact detail → student dcid. Inactive and other-email
// rows are present so a lookup has to drop them.
export const MOCK_GUARDIAN_CHAIN = {
  emailaddress: [
    { emailaddressid: 10, emailaddress: 'Parent@NIS.ac.th' },
    { emailaddressid: 11, emailaddress: 'other@example.com' },
  ],
  personemailaddressassoc: [
    { personid: 100, emailaddressid: 10 },
    { personid: 101, emailaddressid: 11 },
    { personid: 199, emailaddressid: 999 },
  ],
  studentcontactassoc: [
    { studentdcid: 501, studentcontactassocid: 900, personid: 100 },
    { studentdcid: 502, studentcontactassocid: 901, personid: 100 },
    { studentdcid: 9, studentcontactassocid: 902, personid: 101 },
  ],
  studentcontactdetail: [
    { studentcontactassocid: 900, isactive: 1, iscustodial: 0, isemergency: 0 },
    { studentcontactassocid: 901, isactive: 0, iscustodial: 1, isemergency: 1 },
    { studentcontactassocid: 902, isactive: 1, iscustodial: 1, isemergency: 1 },
  ],
  students: [
    {
      dcid: 501,
      id: 501,
      first_name: 'Niran',
      last_name: 'Srisuk',
      nickname: 'Nin',
      grade_level: 5,
      sections: [{ teacherid: 1001, room: '204' }],
    },
    { dcid: 502, id: 502, name: 'Inactive Child', grade: '3' },
    { dcid: 9, id: 9, name: 'Other Child', grade: '1' },
  ],
};
