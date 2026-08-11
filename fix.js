const fs = require('fs');

function replaceLogic(file, searchStr, replaceStr) {
    let content = fs.readFileSync(file, 'utf8');
    // Normalize newlines in both content and search string to deal with CRLF vs LF
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const normalizedSearch = searchStr.replace(/\r\n/g, '\n');
    
    if (normalizedContent.includes(normalizedSearch)) {
        content = normalizedContent.replace(normalizedSearch, replaceStr.replace(/\r\n/g, '\n'));
        fs.writeFileSync(file, content);
        console.log(`Replaced in ${file}`);
    } else {
        console.log(`Search string NOT FOUND in ${file}`);
        // Let's try matching with whitespaces collapsed
        const collapseWhitespace = (str) => str.replace(/\s+/g, '');
        if (collapseWhitespace(normalizedContent).includes(collapseWhitespace(normalizedSearch))) {
            console.log(`It matched with collapsed whitespace, so formatting is the issue.`);
        }
    }
}

const coursesFile = 'c:\\Users\\salmaan\\.gemini\\antigravity\\Tacliimi\\src\\pages\\instructor\\instructor-courses\\index.html';

const coursesSearch1 = `                    const amountPaid = parseFloat(document.getElementById('boost-total').innerText);
                    if (bannerCb && bannerCb.checked) {
                        paymentRes = await PaymentService.startBannerPayment('course', courseId, amountPaid, days, bannerText);
                    } else if (boostCb && boostCb.checked) {
                        paymentRes = await PaymentService.startBoostPayment('course', courseId, amountPaid, days);
                    }`;

const coursesRep1 = `                    const amountPaid = parseFloat(document.getElementById('boost-total').innerText);
                    const boostChecked = boostCb && boostCb.checked;
                    const bannerChecked = bannerCb && bannerCb.checked;
                    const boostCost  = boostChecked  ? (boostSettings.course_boost_price_per_day  * days) : 0;
                    const bannerCost = bannerChecked ? (boostSettings.course_banner_price_per_day * days) : 0;

                    if (boostChecked && bannerChecked) {
                        paymentRes = await PaymentService.startBoostAndBannerPayment('course', courseId, boostCost, bannerCost, days, bannerText);
                    } else if (bannerChecked) {
                        paymentRes = await PaymentService.startBannerPayment('course', courseId, amountPaid, days, bannerText);
                    } else if (boostChecked) {
                        paymentRes = await PaymentService.startBoostPayment('course', courseId, amountPaid, days);
                    }`;

replaceLogic(coursesFile, coursesSearch1, coursesRep1);


const coursesSearch2 = `                         showPaymentModal(paymentRes.amount, paymentRes.currency, {
                             type: (bannerCb && bannerCb.checked) ? 'banner' : 'boost',
                             referenceId: paymentRes.entityId,
                             entityType: paymentRes.entityType,
                             planDays: paymentRes.planDays,
                             bannerText: paymentRes.bannerText
                         });`;
                         
const coursesRep2 = `                         const modalType = (boostChecked && bannerChecked) ? 'boost_and_banner' : (bannerChecked ? 'banner' : 'boost');
                         showPaymentModal(paymentRes.amount, paymentRes.currency, {
                             type: modalType,
                             referenceId: paymentRes.entityId,
                             entityType: paymentRes.entityType,
                             planDays: paymentRes.planDays,
                             bannerText: paymentRes.bannerText,
                             boostAmount: paymentRes.boostAmount,
                             bannerAmount: paymentRes.bannerAmount
                         });`;

replaceLogic(coursesFile, coursesSearch2, coursesRep2);


const mentorFile = 'c:\\Users\\salmaan\\.gemini\\antigravity\\Tacliimi\\src\\pages\\instructor\\instructor-mentorship\\mentorship.js';

const mentorSearch1 = `                            const amountPaid = parseFloat(document.getElementById('boost-total').innerText);
                            if (wantsBanner) {
                                paymentRes = await PaymentService.startBannerPayment('mentorship_sessions', session.id, amountPaid, days, bannerText);
                            } else {
                                paymentRes = await PaymentService.startBoostPayment('mentorship_sessions', session.id, amountPaid, days);
                            }`;

const mentorRep1 = `                            const amountPaid = parseFloat(document.getElementById('boost-total').innerText);
                            const boostCost  = wantsBoost  ? (settings.mentor_boost_price_per_day  * days) : 0;
                            const bannerCost = wantsBanner ? (settings.mentor_banner_price_per_day * days) : 0;
                            
                            if (wantsBoost && wantsBanner) {
                                paymentRes = await PaymentService.startBoostAndBannerPayment('mentorship_sessions', session.id, boostCost, bannerCost, days, bannerText);
                            } else if (wantsBanner) {
                                paymentRes = await PaymentService.startBannerPayment('mentorship_sessions', session.id, amountPaid, days, bannerText);
                            } else {
                                paymentRes = await PaymentService.startBoostPayment('mentorship_sessions', session.id, amountPaid, days);
                            }`;

replaceLogic(mentorFile, mentorSearch1, mentorRep1);

const mentorSearch2 = `                                 showPaymentModal(paymentRes.amount, paymentRes.currency, {
                                     type: wantsBanner ? 'banner' : 'boost',
                                     referenceId: paymentRes.entityId,
                                     entityType: paymentRes.entityType,
                                     planDays: paymentRes.planDays,
                                     bannerText: paymentRes.bannerText
                                 });`;

const mentorRep2 = `                                 const modalType = (wantsBoost && wantsBanner) ? 'boost_and_banner' : (wantsBanner ? 'banner' : 'boost');
                                 showPaymentModal(paymentRes.amount, paymentRes.currency, {
                                     type: modalType,
                                     referenceId: paymentRes.entityId,
                                     entityType: paymentRes.entityType,
                                     planDays: paymentRes.planDays,
                                     bannerText: paymentRes.bannerText,
                                     boostAmount: paymentRes.boostAmount,
                                     bannerAmount: paymentRes.bannerAmount
                                 });`;

replaceLogic(mentorFile, mentorSearch2, mentorRep2);
