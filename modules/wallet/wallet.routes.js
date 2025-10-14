// src/routes/wallet.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import { getWalletHandler ,creditWalletHandler,reserveHandler,finalizeHandler,refundHandler, getWalletLedgerHandler} from './wallet.controller.js';

const router = express.Router();

/**
 * GET current user's wallet
 * Header: Authorization: Bearer <token>
 */

router.get('/', auth(true), getWalletHandler);
router.get('/ledger', auth(true), getWalletLedgerHandler);
router.post('/credit', auth(true), creditWalletHandler);
router.post('/reserve', auth(true), reserveHandler);
router.post('/finalize', auth(true), finalizeHandler);
router.post('/refund', auth(true), refundHandler);
export default router;
