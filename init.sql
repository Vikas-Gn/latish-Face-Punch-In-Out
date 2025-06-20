CREATE TABLE employees (
    employee_id VARCHAR(7) PRIMARY KEY,
    is_punched_in BOOLEAN DEFAULT FALSE,
    last_action_time TIMESTAMP,
    last_action_type VARCHAR(20),
    last_location_latitude DOUBLE PRECISION,
    last_location_longitude DOUBLE PRECISION
);

CREATE TABLE attendance_records (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(7) REFERENCES employees(employee_id),
    punch_type VARCHAR(20) NOT NULL CHECK (punch_type IN ('punchin', 'punchout')),
    punch_time TIMESTAMP NOT NULL,
    image_data TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION
);


CREATE INDEX idx_attendance_employee_date ON attendance_records (employee_id, punch_time);
