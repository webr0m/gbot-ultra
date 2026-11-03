// Passenger/cPanel loads a CommonJS startup file, while the app uses ES modules.
process.chdir(__dirname);
process.env.NODE_ENV = 'production';
void import('./dist/index.js');
