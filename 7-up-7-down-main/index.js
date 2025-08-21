var randomnumber1=Math.floor(Math.random()*6)+1;
var randomnumber2=Math.floor(Math.random()*6)+1;
var text1=randomnumber1.toString()
var text2=randomnumber2.toString()

if(randomnumber1+randomnumber2>7){
    document.querySelector("h1").innerHTML="⬆️ 7 up! ⬆️"
}
else if(randomnumber1+randomnumber2<7){
    document.querySelector("h1").innerHTML="⬇️ 7 down! ⬇️"
}
else{
    document.querySelector("h1").innerHTML="🟰 7 equal! 🟰"
}




document.querySelector(".img1").setAttribute("src",`./images/dice${text1}.png`)
document.querySelector(".img2").setAttribute("src",`./images/dice${text2}.png`)

