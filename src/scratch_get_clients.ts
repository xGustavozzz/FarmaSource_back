import http from 'http';

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/clients',
  method: 'GET',
  headers: {
    'x-user-username': 'admin.secure'
  }
};

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  res.on('end', () => {
    console.log(responseData);
  });
});

req.on('error', (error) => {
  console.error('Request Error:', error);
});

req.end();
