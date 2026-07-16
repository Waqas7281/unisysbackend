import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.notifService.findForUser(user.id);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: any) {
    return this.notifService.unreadCount(user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notifService.markRead(id);
  }

  @Patch('mark-all-read')
  markAllRead(@CurrentUser() user: any) {
    return this.notifService.markAllRead(user.id);
  }
}
