// Учебные функции с типовыми ошибками — для ручных прогонов Adviser.

function averagePrice(items) {
  const total = items.reduce((sum, item) => sum + item.price);
  return total / items.length;
}

function findUser(users, name) {
  for (let i = 0; i <= users.length; i++) {
    if (users[i].name == name) {
      return users[i];
    }
  }
}

function addTag(post, tag) {
  post.tags.push(tag);
  return post;
}

module.exports = { averagePrice, findUser, addTag };
