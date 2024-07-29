browser.menus.create({
  id: "extract-attachments",
  title: "Extract attachments",
  contexts: ["message_list"]
}, onCreated);
browser.menus.create({
  id: "delete-attachments",
  title: "Delete attachments",
  contexts: ["message_list"]
}, onCreated);


browser.menus.onClicked.addListener(onClicked);

/**
 * Helper function to find the full mime details of a part.
 */
function findPart(parts, partName) {
	for (let part of parts || []) {
		if (part.partName == partName) {
			return part;
		}
		const entry = findPart(part.parts, partName);
		if (entry) {
			return entry;
		}
	}
	return null;
}

/**
 * Helper function for getting attachment details from a message.
 */
const getMessageAttachmentDetails = async function(message){
	return {
		message,
		attachments: await browser.messages.listAttachments(message.id),
		full: await browser.messages.getFull(message.id),
	};
}

async function onClicked(info, tab){
	if (info.menuItemId != "extract-attachments" && info.menuItemId != "delete-attachments") {
		return;
	}
	
	var allMessageAttachmentDetails = [];

	// Get first page of messages
	let currentPage = info.selectedMessages;
	if (currentPage.messages.length == 0){
		browser.attachmentExtractorApi.showAlertToUser("Oops", "No message selected. Please select a message (or multiple) with an attachment.");
		return;
	}
	
	// Iterate through the messages
	for (let m of currentPage.messages) {
		allMessageAttachmentDetails.push(await getMessageAttachmentDetails(m));
	}
	// As long as there is an ID, more pages can be fetched
	while (currentPage.id) {
		currentPage = await browser.messages.continueList(currentPage.id);
		for (let m of currentPage.messages) {
			allMessageAttachmentDetails.push(await getMessageAttachmentDetails(m));
		}
	}

	if (info.menuItemId == "extract-attachments") {
		// Call Experiment API to detach attachments from selected messages
		await browser.attachmentExtractorApi.detachAttachmentsFromSelectedMessages(
			allMessageAttachmentDetails
		);
	}
	else if (info.menuItemId == "delete-attachments")  
	{
		await browser.attachmentExtractorApi.deleteAttachmentsFromSelectedMessages(allMessages);
	}else {
		browser.attachmentExtractorApi.showAlertToUser("Oops", "Unknown action.");
	}
	
}

function onCreated() {
}
