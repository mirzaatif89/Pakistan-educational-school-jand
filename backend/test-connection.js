// Quick Database Connection Test
// Run this file with: node backend/test-connection.js

require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
    console.log('🔍 Testing Database Connection...\n');

    console.log('Configuration:');
    console.log(`  Host: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`  User: ${process.env.DB_USER || 'root'}`);
    console.log(`  Database: ${process.env.DB_NAME || 'school_system'}`);
    console.log(`  Port: ${process.env.DB_PORT || '3306'}\n`);

    try {
        // Test 1: Connect to MySQL Server
        console.log('Test 1: Connecting to MySQL Server...');
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306
        });
        console.log('✅ MySQL Server Connection: SUCCESS\n');

        // Test 2: Create Database if not exists
        console.log('Test 2: Creating database if not exists...');
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'school_system'}\`;`);
        console.log('✅ Database Creation: SUCCESS\n');

        // Test 3: Use the database
        console.log('Test 3: Selecting database...');
        await connection.query(`USE \`${process.env.DB_NAME || 'school_system'}\`;`);
        console.log('✅ Database Selection: SUCCESS\n');

        // Test 4: Show tables
        console.log('Test 4: Checking existing tables...');
        const [tables] = await connection.query('SHOW TABLES;');
        if (tables.length > 0) {
            console.log(`✅ Found ${tables.length} table(s):`);
            tables.forEach(table => {
                console.log(`   - ${Object.values(table)[0]}`);
            });
        } else {
            console.log('ℹ️  No tables found (this is normal for first run)');
        }

        await connection.end();

        console.log('\n' + '='.repeat(50));
        console.log('🎉 ALL TESTS PASSED!');
        console.log('='.repeat(50));
        console.log('\nYour database is ready. You can now run:');
        console.log('  npm start\n');

    } catch (error) {
        console.log('\n' + '='.repeat(50));
        console.log('❌ CONNECTION FAILED');
        console.log('='.repeat(50));
        console.log('\nError Details:');
        console.log(`  Code: ${error.code}`);
        console.log(`  Message: ${error.message}\n`);

        console.log('Common Solutions:');
        if (error.code === 'ECONNREFUSED') {
            console.log('  ⚠️  MySQL Server is not running');
            console.log('  → Start XAMPP/WAMP and enable MySQL');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.log('  ⚠️  Wrong username or password');
            console.log('  → Check DB_USER and DB_PASSWORD in .env file');
        } else if (error.code === 'ENOTFOUND') {
            console.log('  ⚠️  Cannot find database host');
            console.log('  → Check DB_HOST in .env file');
        } else {
            console.log('  → Check your .env configuration');
            console.log('  → Ensure MySQL is running on port 3306');
        }
        console.log();
        process.exit(1);
    }
}

testConnection();
