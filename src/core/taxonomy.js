/**
 * Canonical field taxonomy - the spine of applyr.
 *
 * Selector packs map an ATS's DOM onto these ids; the profile schema maps these
 * ids onto the user's data. Neither side ever learns about the other, so adding
 * an ATS is a JSON file and adding a profile field is a schema change.
 *
 * The `ac` / `attr` / `text` matchers below also drive GENERIC MODE: on a site
 * with no pack, the resolver falls back to these patterns and still reaches
 * roughly two thirds of a typical form.
 *
 * @typedef {'text'|'email'|'tel'|'url'|'date'|'month'|'number'|'longtext'|'bool'|'enum'|'file'} FieldType
 * @typedef {Object} FieldDef
 * @property {string}    id          canonical id
 * @property {string}    label       human label, shown in the profile editor
 * @property {string}    group       editor grouping
 * @property {FieldType} type
 * @property {boolean}  [sensitive]  demographic / protected - never filled unless opted in
 * @property {string[]} [ac]         HTML autocomplete tokens that imply this field
 * @property {RegExp[]} [attr]       patterns tested against name/id/data-* attributes
 * @property {RegExp[]} [text]       patterns tested against the visible label text
 * @property {RegExp[]} [not]        disqualifiers - if these match, it is NOT this field
 * @property {string[]} [options]    allowed values for enum fields
 */

/** @type {FieldDef[]} */
export const FIELDS = [
  // -- personal ---------------------------------------------------------------
  {
    id: 'first_name', label: 'First name', group: 'personal', type: 'text',
    ac: ['given-name'],
    attr: [/^(first[_\-\s]?name|fname|given[_\-\s]?name|firstname)$/i, /first[_\-]?name/i],
    text: [/\bfirst\s*name\b/i, /\bgiven\s*name\b/i, /^forename$/i],
    not: [/last/i, /company/i]
  },
  {
    id: 'last_name', label: 'Last name', group: 'personal', type: 'text',
    ac: ['family-name'],
    attr: [/^(last[_\-\s]?name|lname|family[_\-\s]?name|surname|lastname)$/i, /last[_\-]?name/i],
    text: [/\blast\s*name\b/i, /\bfamily\s*name\b/i, /\bsurname\b/i],
    not: [/first/i]
  },
  {
    id: 'full_name', label: 'Full name', group: 'personal', type: 'text',
    ac: ['name'],
    attr: [/^(full[_\-\s]?name|name|your[_\-]?name|candidate[_\-]?name)$/i],
    text: [/^\s*(full\s*)?name\s*\*?\s*$/i, /your\s+name/i, /^(applicant|candidate)\s*name\s*\*?$/i],
    not: [/first/i, /last/i, /user/i, /company/i, /school/i, /file/i, /employer/i]
  },
  {
    id: 'preferred_name', label: 'Preferred name', group: 'personal', type: 'text',
    attr: [/preferred[_\-]?name/i, /nick[_\-]?name/i, /goes[_\-]?by/i],
    text: [/preferred\s*(first\s*)?name/i, /nickname/i]
  },
  {
    id: 'pronouns', label: 'Pronouns', group: 'personal', type: 'text',
    attr: [/pronoun/i], text: [/pronouns?/i]
  },
  {
    id: 'email', label: 'Email', group: 'personal', type: 'email',
    ac: ['email'],
    attr: [/^(e[_\-]?mail|email[_\-]?address|emailaddress)$/i, /e?mail/i],
    text: [/\be-?mail\b/i],
    not: [/confirm/i, /verify/i]
  },
  {
    id: 'phone', label: 'Phone', group: 'personal', type: 'tel',
    ac: ['tel', 'tel-national'],
    attr: [/^(phone|mobile|tel|telephone|phone[_\-]?number|cell)$/i, /phone|mobile|telephone/i],
    text: [/\b(phone|mobile|telephone|cell)\b/i]
  },

  // -- links ------------------------------------------------------------------
  {
    id: 'linkedin_url', label: 'LinkedIn', group: 'links', type: 'url',
    attr: [/linked[_\-]?in/i], text: [/linked\s*in/i]
  },
  {
    id: 'github_url', label: 'GitHub', group: 'links', type: 'url',
    attr: [/git[_\-]?hub/i], text: [/git\s*hub/i]
  },
  {
    id: 'portfolio_url', label: 'Portfolio / website', group: 'links', type: 'url',
    ac: ['url'],
    attr: [/portfolio|website|personal[_\-]?site|web[_\-]?site|homepage/i],
    text: [/portfolio/i, /personal\s*(web)?site/i, /\bwebsite\b/i, /\bhomepage\b/i],
    not: [/company/i, /employer/i]
  },
  {
    id: 'twitter_url', label: 'X / Twitter', group: 'links', type: 'url',
    attr: [/twitter/i, /^x[_\-]?(handle|url|profile)$/i], text: [/twitter/i]
  },
  {
    id: 'other_url', label: 'Other link', group: 'links', type: 'url',
    attr: [/other[_\-]?(url|link|website)/i], text: [/other\s*(link|website|url)/i]
  },

  // -- location ---------------------------------------------------------------
  {
    id: 'address_line1', label: 'Address line 1', group: 'location', type: 'text',
    ac: ['address-line1', 'street-address'],
    attr: [/^(address|address[_\-]?1|street|addressline1|street[_\-]?address)$/i, /address[_\-]?line[_\-]?1/i],
    text: [/^address(\s*line)?\s*1?\s*\*?$/i, /street\s*address/i]
  },
  {
    id: 'address_line2', label: 'Address line 2', group: 'location', type: 'text',
    ac: ['address-line2'],
    attr: [/address[_\-]?line[_\-]?2|address[_\-]?2|apt|suite|unit/i],
    text: [/address\s*line\s*2/i, /\bapt\b|\bsuite\b|\bunit\b/i]
  },
  {
    id: 'city', label: 'City', group: 'location', type: 'text',
    ac: ['address-level2'],
    attr: [/^(city|town|locality)$/i, /\bcity\b/i],
    text: [/^\s*city\b/i, /\btown\b/i]
  },
  {
    id: 'state', label: 'State / province', group: 'location', type: 'text',
    ac: ['address-level1'],
    attr: [/^(state|province|region|state[_\-]?province)$/i, /\bstate\b|\bprovince\b/i],
    text: [/\bstate\b/i, /\bprovince\b/i, /\bregion\b/i]
  },
  {
    id: 'postal_code', label: 'Postal / ZIP code', group: 'location', type: 'text',
    ac: ['postal-code'],
    attr: [/^(zip|postal|postcode|zip[_\-]?code|postal[_\-]?code|pincode|pin[_\-]?code)$/i, /zip|postal|pincode/i],
    text: [/\bzip\b/i, /postal\s*code/i, /\bpost\s*code\b/i, /\bpin\s*code\b/i]
  },
  {
    id: 'country', label: 'Country', group: 'location', type: 'text',
    ac: ['country-name', 'country'],
    attr: [/^country(-?name)?$/i, /\bcountry\b/i],
    text: [/\bcountry\b/i],
    not: [/phone/i, /code/i, /citizen/i]
  },
  {
    id: 'full_address', label: 'Full address (single line)', group: 'location', type: 'text',
    attr: [/^(full[_\-]?address|location)$/i],
    text: [/^\s*location\s*\*?$/i, /current\s*location/i, /where.*located/i]
  },

  // -- work -------------------------------------------------------------------
  {
    id: 'current_company', label: 'Current company', group: 'work', type: 'text',
    ac: ['organization'],
    attr: [/current[_\-]?(company|employer)/i, /^(company|employer|organization|org)$/i],
    text: [/current\s*(company|employer)/i, /^\s*(company|employer)\s*\*?$/i],
    not: [/school|university|college/i]
  },
  {
    id: 'current_title', label: 'Current job title', group: 'work', type: 'text',
    ac: ['organization-title'],
    attr: [/current[_\-]?(title|role|position)/i, /^(title|job[_\-]?title|role|position|designation)$/i],
    text: [/current\s*(title|role|position)/i, /^\s*(job\s*)?title\s*\*?$/i, /designation/i],
    not: [/degree|education|honorific|salutation/i]
  },
  {
    id: 'years_experience', label: 'Years of experience', group: 'work', type: 'number',
    attr: [/years?[_\-]?(of[_\-]?)?experience|total[_\-]?experience|yoe|exp[_\-]?years/i],
    text: [/years?\s*(of\s*)?(relevant\s*|total\s*|professional\s*)?experience/i, /how\s*many\s*years/i, /total\s*experience/i]
  },
  {
    id: 'desired_salary', label: 'Desired salary', group: 'work', type: 'text',
    attr: [/salary|compensation|expected[_\-]?ctc|ctc|remuneration/i],
    text: [/salary\s*(expectation|requirement)?/i, /expected\s*(ctc|compensation)/i, /compensation\s*expectation/i, /desired\s*(pay|salary)/i],
    not: [/current/i]
  },
  {
    id: 'current_salary', label: 'Current salary', group: 'work', type: 'text',
    attr: [/current[_\-]?(salary|ctc)/i], text: [/current\s*(salary|ctc|compensation)/i]
  },
  {
    id: 'skills', label: 'Skills (comma separated)', group: 'work', type: 'longtext',
    attr: [/^skills?$/i, /key[_\-]?skills/i, /technical[_\-]?skills/i],
    text: [/^\s*(key |technical |core )?skills\s*\*?$/i, /areas of expertise/i]
  },
  {
    id: 'notice_period', label: 'Notice period', group: 'work', type: 'text',
    attr: [/notice[_\-]?period/i], text: [/notice\s*period/i, /how\s*soon.*(join|start)/i]
  },
  {
    id: 'earliest_start_date', label: 'Earliest start date', group: 'work', type: 'date',
    attr: [/start[_\-]?date|available[_\-]?from|availability[_\-]?date/i],
    text: [/(earliest|available|preferred)\s*start\s*date/i, /when\s*can\s*you\s*start/i, /availability/i]
  },

  // -- authorization / logistics ----------------------------------------------
  {
    id: 'work_auth_us', label: 'Authorized to work in the US?', group: 'authorization', type: 'bool',
    attr: [/work[_\-]?auth|legally[_\-]?authorized|authorized[_\-]?to[_\-]?work/i],
    text: [/legally\s*(authoriz|entitl)/i, /authoriz(ed|ation)\s*to\s*work/i, /eligible\s*to\s*work/i, /right\s*to\s*work/i],
    not: [/sponsor/i]
  },
  {
    id: 'requires_sponsorship', label: 'Require visa sponsorship?', group: 'authorization', type: 'bool',
    attr: [/sponsorship|require[_\-]?visa|visa[_\-]?sponsor/i],
    text: [/sponsorship/i, /require.*visa/i]
  },
  {
    id: 'visa_status', label: 'Visa / work status', group: 'authorization', type: 'text',
    attr: [/visa[_\-]?status|immigration[_\-]?status|work[_\-]?permit/i],
    text: [/visa\s*status/i, /immigration\s*status/i, /work\s*permit/i]
  },
  {
    id: 'willing_to_relocate', label: 'Willing to relocate?', group: 'authorization', type: 'bool',
    attr: [/relocat/i], text: [/relocat/i]
  },
  {
    id: 'remote_preference', label: 'Remote / onsite preference', group: 'authorization', type: 'text',
    attr: [/remote|hybrid|onsite|work[_\-]?preference/i],
    text: [/remote|hybrid|on-?site/i, /work\s*(location\s*)?preference/i]
  },
  {
    id: 'over_18', label: 'Are you 18 or older?', group: 'authorization', type: 'bool',
    attr: [/over[_\-]?18|age[_\-]?verif|18[_\-]?years/i],
    text: [/\b18\s*(years)?\s*(of\s*age)?\s*or\s*older/i, /are\s*you\s*(at\s*least\s*)?18/i]
  },
  {
    id: 'previously_employed', label: 'Previously employed here?', group: 'authorization', type: 'bool',
    attr: [/previous(ly)?[_\-]?(employ|work)/i],
    text: [/(previously|ever)\s*(been\s*)?(employed|worked)\s*(by|at|for)/i, /former\s*employee/i]
  },
  {
    id: 'non_compete', label: 'Bound by a non-compete?', group: 'authorization', type: 'bool',
    attr: [/non[_\-]?compete/i], text: [/non-?compete/i, /restrictive\s*covenant/i]
  },

  // -- education --------------------------------------------------------------
  {
    id: 'school', label: 'School / university', group: 'education', type: 'text',
    attr: [/school|university|college|institution|alma[_\-]?mater/i],
    text: [/\b(school|university|college|institution)\b/i]
  },
  {
    id: 'degree', label: 'Degree', group: 'education', type: 'text',
    attr: [/degree|qualification/i], text: [/\bdegree\b/i, /qualification/i]
  },
  {
    id: 'field_of_study', label: 'Field of study', group: 'education', type: 'text',
    attr: [/discipline|major|field[_\-]?of[_\-]?study|specialization|branch/i],
    text: [/field\s*of\s*study/i, /\bdiscipline\b/i, /\bmajor\b/i, /specialization/i]
  },
  {
    id: 'graduation_date', label: 'Graduation date', group: 'education', type: 'month',
    attr: [/grad(uation)?[_\-]?(date|year)/i],
    text: [/graduation\s*(date|year)/i, /year\s*of\s*(graduation|passing)/i]
  },
  {
    id: 'gpa', label: 'GPA / grade', group: 'education', type: 'text',
    attr: [/\bgpa\b|percentage|cgpa|grade/i], text: [/\bgpa\b/i, /\bcgpa\b/i, /\bgrade\b/i, /percentage/i]
  },

  // -- documents --------------------------------------------------------------
  {
    id: 'resume_file', label: 'Resume / CV', group: 'documents', type: 'file',
    attr: [/resume|curriculum/i, /^cv$/i, /\bcv[_\-]/i],
    text: [/résumé|resume/i, /\bcv\b/i, /curriculum\s*vitae/i],
    not: [/cover/i]
  },
  {
    id: 'cover_letter_file', label: 'Cover letter (file)', group: 'documents', type: 'file',
    attr: [/cover[_\-]?letter/i], text: [/cover\s*letter/i]
  },
  {
    id: 'cover_letter_text', label: 'Cover letter (text)', group: 'documents', type: 'longtext',
    attr: [/cover[_\-]?(letter|note)|letter[_\-]?text/i], text: [/cover\s*(letter|note)/i]
  },
  {
    id: 'other_file', label: 'Other document', group: 'documents', type: 'file',
    attr: [/portfolio[_\-]?file|other[_\-]?(file|document)|transcript|attachment/i],
    text: [/transcript/i, /other\s*(file|document|attachment)/i]
  },

  // -- screening --------------------------------------------------------------
  {
    id: 'how_did_you_hear', label: 'How did you hear about us?', group: 'screening', type: 'text',
    attr: [/how[_\-]?did[_\-]?you[_\-]?hear|source|referral[_\-]?source/i],
    text: [/how\s*did\s*you\s*hear/i, /how\s*did\s*you\s*(find|learn)/i, /where\s*did\s*you\s*hear/i]
  },
  {
    id: 'referred_by', label: 'Referred by', group: 'screening', type: 'text',
    attr: [/referr?(ed|al)[_\-]?(by|name)?/i],
    text: [/referr?(ed|al)/i, /who\s*referred/i],
    not: [/how\s*did\s*you\s*hear/i]
  },
  {
    id: 'why_this_company', label: 'Why this company?', group: 'screening', type: 'longtext',
    text: [/why\s*(do\s*you\s*want\s*to\s*)?(work|join)\s*(at|for|with)?\s*(us|our)/i, /why\s*(are\s*you\s*)?interested\s*in\s*(us|our|this\s*company)/i]
  },
  {
    id: 'why_this_role', label: 'Why this role?', group: 'screening', type: 'longtext',
    text: [/why\s*(this|the)\s*(role|position|job)/i, /what\s*(interests|excites)\s*you\s*about\s*(this|the)\s*role/i]
  },
  {
    id: 'additional_info', label: 'Anything else we should know?', group: 'screening', type: 'longtext',
    attr: [/additional[_\-]?(info|comment)|other[_\-]?info|^comments?$/i],
    text: [/anything\s*else/i, /additional\s*(information|comments)/i, /^\s*comments?\s*\*?$/i]
  },

  // -- EEO / demographic - sensitive, opt-in only -----------------------------
  {
    id: 'eeo_gender', label: 'Gender', group: 'eeo', type: 'enum', sensitive: true,
    ac: ['sex'],
    attr: [/\bgender\b|\bsex\b/i],
    text: [/\bgender\b/i, /^\s*sex\s*\*?$/i],
    options: ['Male', 'Female', 'Non-binary', 'Decline to self-identify']
  },
  {
    id: 'eeo_hispanic', label: 'Hispanic / Latino', group: 'eeo', type: 'enum', sensitive: true,
    attr: [/hispanic|latino/i], text: [/hispanic|latino/i],
    options: ['Yes', 'No', 'Decline to self-identify']
  },
  {
    id: 'eeo_race', label: 'Race / ethnicity', group: 'eeo', type: 'enum', sensitive: true,
    attr: [/\brace\b|ethnic/i], text: [/\brace\b/i, /ethnicit/i],
    options: [
      'American Indian or Alaska Native', 'Asian', 'Black or African American',
      'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander',
      'White', 'Two or More Races', 'Decline to self-identify'
    ]
  },
  {
    id: 'eeo_veteran', label: 'Veteran status', group: 'eeo', type: 'enum', sensitive: true,
    attr: [/veteran|military/i], text: [/veteran/i, /military\s*service/i],
    options: [
      'I am not a protected veteran',
      'I identify as one or more of the classifications of a protected veteran',
      'Decline to self-identify'
    ]
  },
  {
    id: 'eeo_disability', label: 'Disability status', group: 'eeo', type: 'enum', sensitive: true,
    attr: [/disabilit/i], text: [/disabilit/i, /form\s*cc-?305/i],
    options: [
      'Yes, I have a disability, or have had one in the past',
      'No, I do not have a disability and have not had one in the past',
      'I do not want to answer'
    ]
  },
  {
    id: 'date_of_birth', label: 'Date of birth', group: 'eeo', type: 'date', sensitive: true,
    ac: ['bday'], attr: [/birth|dob/i], text: [/date\s*of\s*birth/i, /\bdob\b/i, /birth\s*date/i]
  },

  // -- consent ----------------------------------------------------------------
  {
    id: 'privacy_consent', label: 'Privacy / data-processing consent', group: 'consent', type: 'bool',
    attr: [/privacy|gdpr|data[_\-]?(processing|consent)|consent/i],
    text: [/privacy\s*(policy|notice)/i, /consent.*(process|store).*data/i, /\bgdpr\b/i]
  },
  {
    id: 'terms_consent', label: 'Terms & conditions', group: 'consent', type: 'bool',
    attr: [/terms|agreement|acknowledg/i],
    text: [/terms\s*(and|&)\s*conditions/i, /i\s*agree/i, /acknowledge/i]
  },
  {
    id: 'marketing_consent', label: 'Marketing / talent-pool opt-in', group: 'consent', type: 'bool',
    attr: [/marketing|newsletter|talent[_\-]?(pool|community)|subscribe|future[_\-]?opportunit/i],
    text: [/talent\s*(pool|community|network)/i, /future\s*(job\s*)?opportunities/i, /newsletter/i, /marketing/i]
  }
];

/** @type {Map<string, FieldDef>} */
export const FIELD_BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

export const GROUPS = [
  { id: 'personal', label: 'Personal' },
  { id: 'links', label: 'Links' },
  { id: 'location', label: 'Location' },
  { id: 'work', label: 'Work' },
  { id: 'authorization', label: 'Eligibility' },
  { id: 'education', label: 'Education' },
  { id: 'documents', label: 'Documents' },
  { id: 'screening', label: 'Screening answers' },
  { id: 'eeo', label: 'Demographics (optional)' },
  { id: 'consent', label: 'Consent' }
];

/** Fields that must never be auto-filled unless the user explicitly opts in. */
export const SENSITIVE_IDS = new Set(FIELDS.filter((f) => f.sensitive).map((f) => f.id));

/** @param {string} id */
export function fieldType(id) {
  const f = FIELD_BY_ID.get(id);
  return f ? f.type : 'text';
}

/** @param {string} id */
export function fieldLabel(id) {
  const f = FIELD_BY_ID.get(id);
  return f ? f.label : id;
}
