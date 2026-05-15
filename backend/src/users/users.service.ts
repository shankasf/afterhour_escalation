import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<Omit<User, 'passwordHash'>[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { name: 'asc' },
    });
    return users.map(({ passwordHash, ...user }) => user);
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findFirst({ 
      where: { phoneNumber: phone, isActive: true } 
    });
  }

  async findOnCallUsers(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { role: UserRole.on_call, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: {
    name: string;
    email: string;
    password?: string;
    phoneNumber?: string;
    role: UserRole;
  }): Promise<Omit<User, 'passwordHash'>> {
    const passwordHash = data.password 
      ? await bcrypt.hash(data.password, 10) 
      : null;

    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        phoneNumber: data.phoneNumber,
        role: data.role,
      },
    });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async update(id: string, data: Partial<{
    name: string;
    email: string;
    password: string;
    phoneNumber: string;
    role: UserRole;
    isActive: boolean;
  }>): Promise<Omit<User, 'passwordHash'>> {
    const updateData: any = { ...data };
    
    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
      delete updateData.password;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    const { passwordHash, ...result } = user;
    return result;
  }

  async deactivate(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async setOnDuty(id: string, onDuty: boolean): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { onDuty },
    });
    const { passwordHash, ...result } = user;
    return result;
  }

  async setOnDutyPriority(id: string, priority: number): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { onDutyPriority: priority },
    });
    const { passwordHash, ...result } = user;
    return result;
  }

  /**
   * Return all eligible staff (on_call + admin) for the Rotation page,
   * ordered by onDutyPriority. Used by the admin UI to render the
   * on-duty toggle list.
   */
  async findRotationCandidates(): Promise<Omit<User, 'passwordHash'>[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [UserRole.on_call, UserRole.admin] },
      },
      orderBy: [{ onDutyPriority: 'asc' }, { name: 'asc' }],
    });
    return users.map(({ passwordHash, ...rest }) => rest);
  }
}
