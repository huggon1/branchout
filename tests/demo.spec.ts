import {test,expect} from '@playwright/test';
test('seven slides, style snapshot, continuous generation, and evidence',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 for(const [id,title] of [['home','把关注，织成见解。'],['inbox','一次转发，发现一个主题。'],['topics','决定关注什么，也决定怎么读。'],['profiles','从博主的文章，学会组织信息。'],['collect','把分散的信息，先收集完整。'],['compose','收集得全，还要讲得好。'],['feed','读到重点，也能回到来源。']]){
  await page.goto('/#'+id);await expect(page.locator('.narrative h1')).toHaveText(title);await expect(page.locator('main')).toBeVisible();await page.screenshot({path:'/tmp/feedloom-'+id+'.png',fullPage:true});
 }
 await page.goto('/#topics');await page.locator('.profile-options button').nth(1).click();
 await page.goto('/#collect');await page.getByLabel('连续生成 Feed').check();await page.getByRole('button',{name:'立即模拟一次'}).click();await expect(page.locator('.feed-article>h2')).toHaveText('仓库上下文工具值得试，效果仍需自己验证',{timeout:15000});
 await page.getByRole('button',{name:'打开证据抽屉'}).click();await expect(page.locator('.evidence-row')).toHaveCount(3);await page.locator('.evidence-row').first().click();await expect(page.getByText('demo://source/s1（示例引用，不是外部网址）')).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.reload();await expect(page.locator('.feed-selection button')).toHaveCount(2);expect(errors).toEqual([]);
});
test('failure blocks generation, cancellation and reset are safe',async({page})=>{
 await page.goto('/#collect');await page.getByLabel('演示场景').selectOption('failed');await page.getByRole('button',{name:'立即模拟一次'}).click();await expect(page.getByRole('heading',{name:'来源访问失败，未生成内容'})).toBeVisible({timeout:8000});await page.goto('/#compose');await expect(page.getByRole('button',{name:'模拟生成 Feed',exact:true})).toBeDisabled();
 await page.goto('/#inbox');await page.getByRole('button',{name:'重新模拟转发'}).click();await page.getByRole('button',{name:'取消运行',exact:true}).click();await expect(page.locator('.progress')).toHaveCount(0);
 await page.getByRole('button',{name:'重置演示'}).click();await expect(page.locator('.narrative h1')).toHaveText('把关注，织成见解。');await page.goto('/#feed');await expect(page.locator('.feed-selection button')).toHaveCount(1);
});
