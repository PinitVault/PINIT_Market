import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';

export const authRouter = Router();

authRouter.post('/create',  authController.createAccount);
authRouter.post('/login',   authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout',  authController.logout);
authRouter.get('/me',       requireAuth, authController.me);
