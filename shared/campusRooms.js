export const campusRoomDefinitions = [
  {
    label: 'Pyay Campus',
    value: 'Pyay Campus Room',
    rooms: ['Theater', 'Room-1 (1st Floor)', 'Room-2 (1st Floor)'],
  },
  {
    label: 'Pan Chan Tower',
    value: 'PanChan Tower Room',
    rooms: [
      'Room-Theater (YT5-108)',
      'Room-3 (YT5-118)',
      'Room-4 (YT5-204)',
      'Room-5 (YT5-203)',
      'Room-6 (YT5-115)',
      'Academic Room (YT5-109)',
      'Meeting Room',
      'VR Lab Room',
      'Studio Room',
    ],
  },
  {
    label: 'U Wisara Campus',
    value: 'U Wisara Campus Room KPI',
    rooms: ['Meeting Room', '3rd Floor', '4th Floor', '5th Floor', '6th Floor'],
  },
  {
    label: 'Times City',
    value: 'Time City Room',
    rooms: [
      'Mazzadine (2nd Floor) Activity Room',
      'Room 301 (3rd Floor) Big',
      'Room 302 (3rd Floor) Small',
      'Room 401 (4th Floor) Big',
      'Room 501 (5th Floor) Big',
      'Room 502 (5th Floor) Lab',
      'Room 601 (6th Floor) Big',
      'Room 602 (6th Floor) Small',
      'Room 701 (7th Floor) Theater',
    ],
  },
  {
    label: 'Sule Campus',
    value: 'Sule Room',
    rooms: [
      'Room 1 (Ground)',
      'Room 2 (1st Floor)',
      'Room 3 (2nd Floor)',
      'Room 4 (3rd Floor)',
      'Room 5 (4th Floor)',
      'Room 6 (2nd Floor)',
      'Room 7 (3rd Floor)',
    ],
  },
];

export const campuses = campusRoomDefinitions.map((campus) => campus.value);

export const campusRoomMap = Object.fromEntries(
  campusRoomDefinitions.map((campus) => [campus.value, [...campus.rooms]]),
);

export function getFixedRoomNames(campusName) {
  return campusRoomMap[campusName] ? [...campusRoomMap[campusName]] : [];
}

export function getCampusLabel(campusName) {
  return campusRoomDefinitions.find((campus) => campus.value === campusName)?.label || campusName || 'All';
}
