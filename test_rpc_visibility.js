
import { createClient } from '@supabase/supabase-client';
import fs from 'fs';

const supabaseUrl = 'https://jboruccxbgdqntrggslz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Implb3J1Y2N4YmdkcW50cmdnc2x6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMTM4MzgsImV4cCI6MjA1Njc4OTgzOH0.W2YV_8M_HBNz0QO3mK5m9AihXG7H5V8qW7i-5vXm9zE'; // Extracted from provided context or previous files

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testRPCs() {
    console.log('Testing Admin RPCs...');
    
    const { data: pending, error: e1 } = await supabase.rpc('get_pending_courses_admin');
    console.log('Pending Courses:', pending ? pending.length : 0, e1 ? e1.message : '');
    
    const { data: users, error: e2 } = await supabase.rpc('get_all_users_admin');
    console.log('All Users:', users ? users.length : 0, e2 ? e2.message : '');
    
    const { data: instructors, error: e3 } = await supabase.rpc('get_all_instructors_admin');
    console.log('All Instructors:', instructors ? instructors.length : 0, e3 ? e3.message : '');
    
    if (instructors) {
        console.log('Instructors Data Sample:', JSON.stringify(instructors.slice(0, 1), null, 2));
    }
}

testRPCs();
