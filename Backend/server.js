const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = 3081;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // Handle large image data
app.use(express.json());

// PostgreSQL connection configuration
const pool = new Pool({
    user: 'postgres', // Replace with your PostgreSQL username
    host: 'postgres',
    database: 'FaceReco-Punch', // Replace with your database name
    password: 'admin123', // Replace with your PostgreSQL password
    port: 5432,
});

// Validate Employee ID
function validateEmployeeId(id) {
    const regex = /^ATS0(?!000)\d{3}$/;
    return regex.test(id);
}

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { employeeId } = req.body;

    if (!validateEmployeeId(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID format. Use ATS0XXX (XXX from 001 to 999)' });
    }

    try {
        const result = await pool.query(
            'SELECT employee_id FROM employees WHERE employee_id = $1',
            [employeeId]
        );

        if (result.rows.length === 0) {
            // If employee doesn't exist, create a new one
            await pool.query(
                'INSERT INTO employees (employee_id) VALUES ($1)',
                [employeeId]
            );
        }

        res.status(200).json({ message: 'Login successful', employeeId });
    } catch (err) {
        console.error('Error during login:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Punch in/out endpoint
app.post('/api/punch', async (req, res) => {
    const { employeeId, type, imageData, location } = req.body;

    if (!validateEmployeeId(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID format' });
    }

    if (!['punchin', 'punchout'].includes(type)) {
        return res.status(400).json({ error: 'Invalid punch type' });
    }

    try {
        const timestamp = new Date();
        await pool.query(
            'INSERT INTO attendance_records (employee_id, punch_type, punch_time, image_data, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6)',
            [employeeId, type, timestamp, imageData, location?.latitude || null, location?.longitude || null]
        );

        // Update employee status
        await pool.query(
            'UPDATE employees SET is_punched_in = $1, last_action_time = $2, last_action_type = $3, last_location_latitude = $4, last_location_longitude = $5 WHERE employee_id = $6',
            [
                type === 'punchin',
                timestamp,
                type,
                type === 'punchin' ? location?.latitude || null : null,
                type === 'punchin' ? location?.longitude || null : null,
                employeeId
            ]
        );

        res.status(200).json({ message: `Successfully ${type === 'punchin' ? 'punched in' : 'punched out'}`, timestamp });
    } catch (err) {
        console.error('Error saving punch:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get attendance records
app.get('/api/records', async (req, res) => {
    const { employeeId, date } = req.query;

    try {
        let query = `
            SELECT 
                employee_id,
                punch_type,
                punch_time,
                image_data,
                latitude,
                longitude
            FROM attendance_records
            WHERE 1=1
        `;
        const values = [];
        let paramIndex = 1;

        if (employeeId) {
            query += ` AND employee_id = $${paramIndex}`;
            values.push(employeeId);
            paramIndex++;
        }

        if (date) {
            query += ` AND DATE(punch_time) = $${paramIndex}`;
            values.push(date);
        }

        query += ' ORDER BY punch_time DESC';

        const result = await pool.query(query, values);

        // Group records by employee and date
        const groupedRecords = {};
        result.rows.forEach(record => {
            const recordDate = new Date(record.punch_time).toLocaleDateString();
            const key = `${record.employee_id}-${recordDate}`;

            if (!groupedRecords[key]) {
                groupedRecords[key] = {
                    employeeId: record.employee_id,
                    date: recordDate,
                    punchIn: null,
                    punchOut: null,
                    punchInImage: null,
                    punchOutImage: null,
                    punchInLocation: null,
                    punchOutLocation: null
                };
            }

            const location = record.latitude && record.longitude ? {
                latitude: record.latitude,
                longitude: record.longitude
            } : null;

            if (record.punch_type === 'punchin') {
                if (!groupedRecords[key].punchIn || new Date(record.punch_time) < new Date(groupedRecords[key].punchIn.punch_time)) {
                    groupedRecords[key].punchIn = {
                        dateTime: record.punch_time,
                        timestamp: new Date(record.punch_time).getTime()
                    };
                    groupedRecords[key].punchInImage = record.image_data;
                    groupedRecords[key].punchInLocation = location;
                }
            } else {
                if (!groupedRecords[key].punchOut || new Date(record.punch_time) > new Date(groupedRecords[key].punchOut.punch_time)) {
                    groupedRecords[key].punchOut = {
                        dateTime: record.punch_time,
                        timestamp: new Date(record.punch_time).getTime()
                    };
                    groupedRecords[key].punchOutImage = record.image_data;
                    groupedRecords[key].punchOutLocation = location;
                }
            }
        });

        const records = Object.values(groupedRecords);
        res.status(200).json(records);
    } catch (err) {
        console.error('Error fetching records:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete attendance records
app.delete('/api/records', async (req, res) => {
    const { records } = req.body; // Array of { employeeId, date }

    if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'No records selected for deletion' });
    }

    try {
        for (const { employeeId, date } of records) {
            await pool.query(
                'DELETE FROM attendance_records WHERE employee_id = $1 AND DATE(punch_time) = $2',
                [employeeId, date]
            );
        }

        res.status(200).json({ message: 'Records deleted successfully' });
    } catch (err) {
        console.error('Error deleting records:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get employee status
app.get('/api/employee-status/:employeeId', async (req, res) => {
    const { employeeId } = req.params;

    if (!validateEmployeeId(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID format' });
    }

    try {
        const result = await pool.query(
            'SELECT is_punched_in, last_action_time, last_action_type, last_location_latitude, last_location_longitude FROM employees WHERE employee_id = $1',
            [employeeId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        const status = result.rows[0];
        res.status(200).json({
            isPunchedIn: status.is_punched_in,
            lastActionTime: status.last_action_time,
            lastActionType: status.last_action_type,
            location: status.last_location_latitude && status.last_location_longitude ? {
                latitude: status.last_location_latitude,
                longitude: status.last_location_longitude
            } : null
        });
    } catch (err) {
        console.error('Error fetching employee status:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://13.235.128.250:${port}`);
});