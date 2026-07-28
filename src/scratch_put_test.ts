import http from 'http';

const data = JSON.stringify({
  ciuId: 1,
  firstName: "Flores",
  lastName: "Ramírez",
  cedula: "0705551234",
  phone: "0976543210",
  email: "ana.ramirez@email.com",
  address: "Urb. Las Palmas Mz 5 Casa 2",
  birthDate: "1978-11-30",
  isActive: true
});

const byteLength = Buffer.byteLength(data, 'utf8');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/clients/3',
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'x-user-username': 'admin.secure',
    'Content-Length': byteLength
  }
};

const req = http.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  res.on('end', () => {
    console.log('Response Body:', responseData);
  });
});

req.on('error', (error) => {
  console.error('Request Error:', error);
});

req.write(data);
req.end();
