import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb } from './config/db';
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import productsRouter from './routes/products';
import clientsRouter from './routes/clients';
import salesRouter from './routes/sales';
import employeesRouter from './routes/employees';
import auditRouter from './routes/audit';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

import { authMiddleware, requireRole } from './middleware/security';

// Wire Routes
app.use('/api/auth', authRouter);
app.use('/api/dashboard', authMiddleware, requireRole('ADMINISTRADOR', 'AUDITOR'), dashboardRouter);
app.use('/api/products', authMiddleware, productsRouter); // GET is public to authenticated users, write is protected in routes/products.ts
app.use('/api/clients', authMiddleware, requireRole('ADMINISTRADOR', 'VENDEDOR', 'CAJERO'), clientsRouter);
app.use('/api/sales', authMiddleware, requireRole('ADMINISTRADOR', 'VENDEDOR', 'CAJERO'), salesRouter);
app.use('/api/employees', authMiddleware, requireRole('ADMINISTRADOR'), employeesRouter);
app.use('/api/audit', authMiddleware, requireRole('ADMINISTRADOR', 'AUDITOR'), auditRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Initialize DB and start server
async function startServer() {
  try {
    await initDb();
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Failed to start server due to database initialization error:', err);
    process.exit(1);
  }
}

startServer();
