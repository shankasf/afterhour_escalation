import {
  Body,
  Controller,
  Delete,
  Headers,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PushService } from './push.service';

interface SubscribeBody {
  endpoint: string;
  p256dh: string;
  auth: string;
  origin: string;
  userAgent?: string;
  customerSessionId?: string;
}

@ApiTags('push')
@Controller('push')
export class PushController {
  private readonly logger = new Logger(PushController.name);

  constructor(private readonly pushService: PushService) {}

  @Post('subscribe')
  @ApiOperation({
    summary: 'Save a Web Push subscription (auth optional for anonymous customers)',
  })
  async subscribe(
    @Body() body: SubscribeBody,
    @Headers('authorization') authHeader?: string,
    @Req() req?: any,
  ): Promise<{ ok: true }> {
    let userId: string | undefined;
    if (authHeader && req?.user?.userId) {
      userId = req.user.userId;
    }

    await this.pushService.saveSubscription({
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      origin: body.origin,
      userAgent: body.userAgent,
      userId,
      customerSessionId: body.customerSessionId,
    });

    this.logger.log(
      `push subscribe origin=${body.origin} userId=${userId ?? 'anon'}`,
    );
    return { ok: true };
  }

  @Post('subscribe/authed')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Save a Web Push subscription for the authed user' })
  async subscribeAuthed(
    @Body() body: SubscribeBody,
    @Req() req: any,
  ): Promise<{ ok: true }> {
    await this.pushService.saveSubscription({
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      origin: body.origin,
      userAgent: body.userAgent,
      userId: req.user?.userId,
    });
    return { ok: true };
  }

  @Delete('subscribe')
  @ApiOperation({ summary: 'Remove a Web Push subscription' })
  async unsubscribe(
    @Body() body: { endpoint: string },
  ): Promise<{ ok: true }> {
    await this.pushService.removeSubscription(body.endpoint);
    return { ok: true };
  }
}
