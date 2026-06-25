import { CourseService } from './src/services/courseService.js';

const courseId = '07568ff8-6cef-4b73-8585-31b3595f2efb';

async function test() {
  try {
    console.log('Fetching course for review...');
    const data = await CourseService.getCourseForReview(courseId);
    console.log('Result data keys:', data ? Object.keys(data) : 'null');
    if (data) {
      console.log('Sections length:', data.sections ? data.sections.length : 'undefined');
      if (data.sections && data.sections.length > 0) {
        console.log('First section:', JSON.stringify(data.sections[0], null, 2));
      }
    }
  } catch (e) {
    console.error('Error occurred in test_service:', e);
  }
}

test();
