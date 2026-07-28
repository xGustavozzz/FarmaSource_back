import bcrypt from 'bcryptjs';

const hash = bcrypt.hashSync('admin123', 12);
console.log('Hash for admin123:', hash);
