function showComment(comment) {
  const box = document.getElementById('comments');
  box.innerHTML += '<p>' + comment.text + '</p>';
}
