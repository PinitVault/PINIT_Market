import type { Request, Response } from 'express';
import { authService } from '../../services/auth/auth.service';

export const authController = {
  async createAccount(_req: Request, res: Response) {
    const result = await authService.createAccount();
    res.status(201).json({ success: true, data: result });
  },

  async login(req: Request, res: Response) {
    const { shortId } = req.body as { shortId: string };
    if (!shortId) {
      res.status(400).json({ success: false, error: 'shortId is required' });
      return;
    }
    try {
      const result = await authService.loginWithId(shortId);
      res.json({ success: true, data: result });
    } catch {
      res.status(401).json({ success: false, error: 'Invalid User ID. Please check and try again.' });
    }
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = req.body as { refreshToken: string };
    if (!refreshToken) { res.status(400).json({ success: false, error: 'refreshToken required' }); return; }
    try {
      const tokens = await authService.refresh(refreshToken);
      res.json({ success: true, data: tokens });
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }
  },

  async logout(req: Request, res: Response) {
    const { refreshToken } = req.body as { refreshToken: string };
    if (refreshToken) await authService.logout(refreshToken);
    res.json({ success: true });
  },

  async me(req: Request, res: Response) {
    res.json({ success: true, data: (req as any).user });
  },
};
