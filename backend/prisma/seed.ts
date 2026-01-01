import { PrismaClient, UserRole, ContactType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@afterhours.com' },
    update: {},
    create: {
      name: 'System Admin',
      email: 'admin@afterhours.com',
      passwordHash: adminPassword,
      phoneNumber: '+1234567890',
      role: UserRole.admin,
      isActive: true,
    },
  });
  console.log('✅ Created admin user:', admin.email);

  // Create on-call staff (Jordan and Christina for rotation)
  const jordan = await prisma.user.upsert({
    where: { email: 'jordan@company.com' },
    update: {},
    create: {
      name: 'Jordan',
      email: 'jordan@company.com',
      phoneNumber: '+1111111111',
      role: UserRole.on_call,
      isActive: true,
    },
  });

  const christina = await prisma.user.upsert({
    where: { email: 'christina@company.com' },
    update: {},
    create: {
      name: 'Christina',
      email: 'christina@company.com',
      phoneNumber: '+1222222222',
      role: UserRole.on_call,
      isActive: true,
    },
  });
  console.log('✅ Created on-call staff: Jordan, Christina');

  // Create fixed escalation contacts
  const fixedContacts = [
    { name: 'Matt Mehler', email: 'matt.mehler@company.com', phone: '+1333333333', position: 3 },
    { name: 'Karina Blondet', email: 'karina.blondet@company.com', phone: '+1444444444', position: 4 },
    { name: 'Katelyn Badger', email: 'katelyn.badger@company.com', phone: '+1555555555', position: 5 },
    { name: 'Stefi', email: 'stefi@company.com', phone: '+1666666666', position: 6 },
    { name: 'Eric', email: 'eric@company.com', phone: '+1777777777', position: 7 },
    { name: 'Rocco', email: 'rocco@company.com', phone: '+1888888888', position: 8 },
  ];

  for (const contact of fixedContacts) {
    const user = await prisma.user.upsert({
      where: { email: contact.email },
      update: {},
      create: {
        name: contact.name,
        email: contact.email,
        phoneNumber: contact.phone,
        role: UserRole.on_call,
        isActive: true,
      },
    });

    await prisma.escalationContact.upsert({
      where: { userId_contactType: { userId: user.id, contactType: ContactType.fixed } },
      update: { position: contact.position },
      create: {
        userId: user.id,
        position: contact.position,
        contactType: ContactType.fixed,
        isActive: true,
      },
    });
  }
  console.log('✅ Created fixed escalation contacts');

  // Create initial on-call rotation (current week)
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6); // Saturday

  await prisma.onCallRotation.upsert({
    where: { id: 'initial-rotation' },
    update: {},
    create: {
      id: 'initial-rotation',
      startDate: startOfWeek,
      endDate: endOfWeek,
      primaryUserId: jordan.id,
      secondaryUserId: christina.id,
    },
  });
  console.log('✅ Created initial on-call rotation');

  // Create escalation contacts for rotation users
  await prisma.escalationContact.upsert({
    where: { userId_contactType: { userId: jordan.id, contactType: ContactType.primary } },
    update: {},
    create: {
      userId: jordan.id,
      position: 1,
      contactType: ContactType.primary,
      isActive: true,
    },
  });

  await prisma.escalationContact.upsert({
    where: { userId_contactType: { userId: christina.id, contactType: ContactType.secondary } },
    update: {},
    create: {
      userId: christina.id,
      position: 2,
      contactType: ContactType.secondary,
      isActive: true,
    },
  });

  // Seed system settings
  const settings = [
    { key: 'emergency_score_threshold', value: '0.6', description: 'Minimum score to trigger escalation (0-1)' },
    { key: 'acknowledgment_timeout_seconds', value: '120', description: 'Seconds to wait for ACK before next contact' },
    { key: 'escalation_window_start', value: '00:00', description: 'Start of after-hours window (HH:mm)' },
    { key: 'escalation_window_end', value: '07:00', description: 'End of after-hours window (HH:mm)' },
    { key: 'timezone', value: 'America/New_York', description: 'System timezone' },
    { key: 'sla_response_minutes', value: '15', description: 'SLA target for acknowledgment (minutes)' },
    { key: 'sla_onsite_hours', value: '4', description: 'SLA target for on-site response (hours)' },
    { key: 'data_retention_days', value: '90', description: 'Days to retain event data' },
  ];

  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: setting,
    });
  }
  console.log('✅ Created system settings');

  // Seed emergency keywords
  const keywords = [
    // High weight - critical emergencies
    { keyword: 'no power', weight: 0.9, category: 'critical', isNegative: false },
    { keyword: 'power outage', weight: 0.9, category: 'critical', isNegative: false },
    { keyword: 'system down', weight: 0.85, category: 'critical', isNegative: false },
    { keyword: 'flood', weight: 0.95, category: 'critical', isNegative: false },
    { keyword: 'flooding', weight: 0.95, category: 'critical', isNegative: false },
    { keyword: 'leak', weight: 0.85, category: 'critical', isNegative: false },
    { keyword: 'water leak', weight: 0.9, category: 'critical', isNegative: false },
    { keyword: 'fire alarm', weight: 0.95, category: 'critical', isNegative: false },
    { keyword: 'fire', weight: 0.9, category: 'critical', isNegative: false },
    { keyword: 'hvac failure', weight: 0.85, category: 'critical', isNegative: false },
    { keyword: 'no heat', weight: 0.85, category: 'critical', isNegative: false },
    { keyword: 'no cooling', weight: 0.8, category: 'critical', isNegative: false },
    { keyword: 'no ac', weight: 0.8, category: 'critical', isNegative: false },
    { keyword: 'elevator stuck', weight: 0.9, category: 'critical', isNegative: false },
    { keyword: 'security breach', weight: 0.9, category: 'critical', isNegative: false },
    { keyword: 'break-in', weight: 0.9, category: 'critical', isNegative: false },
    { keyword: "can't operate", weight: 0.85, category: 'critical', isNegative: false },
    { keyword: 'cannot operate', weight: 0.85, category: 'critical', isNegative: false },
    
    // Medium weight - urgent
    { keyword: 'urgent', weight: 0.7, category: 'urgent', isNegative: false },
    { keyword: 'emergency', weight: 0.75, category: 'urgent', isNegative: false },
    { keyword: 'immediately', weight: 0.65, category: 'urgent', isNegative: false },
    { keyword: 'asap', weight: 0.6, category: 'urgent', isNegative: false },
    { keyword: 'offline', weight: 0.6, category: 'urgent', isNegative: false },
    { keyword: 'after hours', weight: 0.5, category: 'urgent', isNegative: false },
    { keyword: 'not working', weight: 0.5, category: 'urgent', isNegative: false },
    { keyword: 'broken', weight: 0.5, category: 'urgent', isNegative: false },
    
    // Negative weight - reduce score
    { keyword: 'pm', weight: 0.3, category: 'routine', isNegative: true },
    { keyword: 'preventive maintenance', weight: 0.4, category: 'routine', isNegative: true },
    { keyword: 'scheduled', weight: 0.35, category: 'routine', isNegative: true },
    { keyword: 'routine', weight: 0.4, category: 'routine', isNegative: true },
    { keyword: 'cosmetic', weight: 0.3, category: 'routine', isNegative: true },
    { keyword: 'minor', weight: 0.25, category: 'routine', isNegative: true },
    { keyword: 'when convenient', weight: 0.3, category: 'routine', isNegative: true },
    { keyword: 'next week', weight: 0.35, category: 'routine', isNegative: true },
  ];

  for (const kw of keywords) {
    await prisma.emergencyKeyword.upsert({
      where: { id: `kw-${kw.keyword.replace(/\s+/g, '-')}` },
      update: { weight: kw.weight, category: kw.category, isNegative: kw.isNegative },
      create: {
        id: `kw-${kw.keyword.replace(/\s+/g, '-')}`,
        keyword: kw.keyword,
        weight: kw.weight,
        category: kw.category,
        isNegative: kw.isNegative,
        isActive: true,
      },
    });
  }
  console.log('✅ Created emergency keywords');

  // Initialize email polling status
  await prisma.emailPollingStatus.upsert({
    where: { id: 'main-poller' },
    update: {},
    create: {
      id: 'main-poller',
      status: 'idle',
      messagesProcessed: 0,
      errorsCount: 0,
    },
  });
  console.log('✅ Initialized email polling status');

  console.log('🎉 Database seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
