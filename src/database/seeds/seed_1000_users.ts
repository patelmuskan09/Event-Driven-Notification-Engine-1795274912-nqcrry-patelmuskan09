import { SupportedLanguage } from '../../events/models/event';

export interface SeedUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  preferredLanguage: SupportedLanguage;
  timezone: string;
  accountType: 'RETAIL' | 'HNI' | 'PRO';
  riskProfile: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  isDndRegistered: boolean;
  quietHours: { enabled: boolean; startTime: string; endTime: string };
}

export function generate1000Users(): SeedUser[] {
  const users: SeedUser[] = [];
  const firstNames = [
    'Aarav',
    'Vihaan',
    'Aditya',
    'Rohan',
    'Muskan',
    'Pooja',
    'Ananya',
    'Sneha',
    'Vikram',
    'Priya',
    'Karthik',
    'Suresh',
    'Deepak',
    'Meera',
    'Rahul',
  ];
  const lastNames = [
    'Patel',
    'Sharma',
    'Verma',
    'Gupta',
    'Iyer',
    'Reddy',
    'Deshmukh',
    'Mehta',
    'Nair',
    'Kulkarni',
    'Joshi',
    'Chopra',
  ];
  const languages: SupportedLanguage[] = ['en', 'hi', 'mr', 'ta', 'te'];
  const accountTypes: ('RETAIL' | 'HNI' | 'PRO')[] = ['RETAIL', 'RETAIL', 'RETAIL', 'HNI', 'PRO'];
  const riskProfiles: ('CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE')[] = [
    'CONSERVATIVE',
    'MODERATE',
    'AGGRESSIVE',
  ];

  for (let i = 1; i <= 1000; i++) {
    const id = `USR-${100000 + i}`;
    const first = firstNames[i % firstNames.length];
    const last = lastNames[i % lastNames.length];
    const fullName = `${first} ${last}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@finvest.in`;
    const phone = `+9198${(10000000 + i * 7).toString().slice(0, 8)}`;
    const preferredLanguage = languages[i % languages.length];
    const accountType = accountTypes[i % accountTypes.length];
    const riskProfile = riskProfiles[i % riskProfiles.length];
    // approx 28% users on DND
    const isDndRegistered = i % 7 === 0 || i % 11 === 0;

    users.push({
      id,
      fullName,
      email,
      phone,
      preferredLanguage,
      timezone: 'Asia/Kolkata',
      accountType,
      riskProfile,
      isDndRegistered,
      quietHours: {
        enabled: true,
        startTime: '21:00',
        endTime: '08:00',
      },
    });
  }

  return users;
}
